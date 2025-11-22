import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { DOMElement, NetworkEntry, BrowserState } from './types';
import { extractSimplifiedDOM } from './dom-simplifier';
import * as fs from 'fs';
import * as path from 'path';
import CDP from 'chrome-remote-interface';

export class PlaywrightController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private networkEntries: NetworkEntry[] = [];
  private consoleErrors: string[] = [];
  private tracingPath: string | null = null;
  private backendLogs: string[] = [];
  private cdpClient: any = null;

  async initialize(headless: boolean = false): Promise<void> {
    try {
      this.browser = await chromium.launch({ 
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Help with some permission issues
      });
    } catch (error: any) {
      if (error.message.includes('Executable doesn\'t exist') || error.message.includes('BrowserType')) {
        throw new Error('Chromium browser not installed. Run: npx playwright install chromium');
      }
      throw error;
    }
    
    try {
      // Ensure video directory exists
      const videoDir = path.join(process.cwd(), 'runs', 'videos');
      if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
      }
      
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: {
          dir: videoDir,
          size: { width: 1280, height: 720 }
        }
      });
    } catch (error: any) {
      await this.browser.close();
      throw new Error(`Failed to create browser context: ${error.message}`);
    }

    this.page = await this.context.newPage();

    // Capture console errors
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push(msg.text());
      }
    });

    // Capture network requests
    this.page.on('request', (request) => {
      this.networkEntries.push({
        url: request.url(),
        method: request.method(),
        requestHeaders: request.headers(),
        timestamp: Date.now()
      });
    });

    this.page.on('response', (response) => {
      const request = response.request();
      const entry = this.networkEntries.find(e => e.url === request.url() && !e.status);
      if (entry) {
        entry.status = response.status();
        entry.responseHeaders = response.headers();
      }
    });

    // Start tracing
    await this.context.tracing.start({
      screenshots: true,
      snapshots: true
    });

    // Start backend error/log monitoring
    this.monitorBackendLogs();
  }
  /**
   * Connects to Node.js inspector and listens for console/error events.
   */
  async monitorBackendLogs(): Promise<void> {
    try {
      this.cdpClient = await CDP({ port: 9229 });
      const { Runtime } = this.cdpClient;
      await Runtime.enable();
      Runtime.consoleAPICalled((payload: { type: string; args: Array<{ value: any }>; }) => {
        if (payload.type === 'error' || payload.type === 'warning' || payload.type === 'log') {
          const logMsg = payload.args.map((a: { value: any }) => a.value).join(' ');
          this.backendLogs.push(`[${payload.type}] ${logMsg}`);
        }
      });
      Runtime.exceptionThrown((payload: { exceptionDetails: { text: string } }) => {
        this.backendLogs.push(`[exception] ${payload.exceptionDetails.text}`);
      });
    } catch (err) {
      this.backendLogs.push(`[monitor error] ${err}`);
    }
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(url, { waitUntil: 'networkidle' });
  }

  async getDOM(): Promise<DOMElement[]> {
    if (!this.page) throw new Error('Browser not initialized');
    return await extractSimplifiedDOM(this.page);
  }

  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    
    // Clean up selector - handle "or" patterns and extract text
    let cleanSelector = selector.trim();
    
    // Handle selectors like "button or text="Add to Cart""
    if (cleanSelector.includes(' or ')) {
      // Extract the text part
      const textMatch = cleanSelector.match(/text=["']([^"']+)["']/);
      if (textMatch) {
        cleanSelector = textMatch[1];
      } else {
        // Extract button part
        const buttonMatch = cleanSelector.match(/(button|a|input)/);
        if (buttonMatch) {
          cleanSelector = cleanSelector.split(' or ')[0].trim();
        }
      }
    }
    
    try {
      // Try different selector strategies
      if (cleanSelector.startsWith('text=')) {
        const text = cleanSelector.replace('text=', '').replace(/"/g, '').replace(/'/g, '');
        await this.page.getByText(text).first().click();
      } else if (cleanSelector.includes('getByRole')) {
        // Extract role and name from selector like "getByRole('button', { name: 'Add' })"
        const match = cleanSelector.match(/getByRole\(['"]([^'"]+)['"],\s*\{\s*name:\s*['"]([^'"]+)['"]\s*\}\)/);
        if (match) {
          await this.page.getByRole(match[1] as any, { name: match[2] }).click();
        } else {
          await this.page.locator(cleanSelector).click();
        }
      } else if (cleanSelector.match(/^["']([^"']+)["']$/)) {
        // If selector is just quoted text, use getByText
        const text = cleanSelector.replace(/["']/g, '');
        await this.page.getByText(text).first().click();
      } else if (!cleanSelector.includes('[') && !cleanSelector.includes('(') && !cleanSelector.startsWith('.') && !cleanSelector.startsWith('#') && !cleanSelector.includes(' ')) {
        // If it looks like plain text (no CSS selectors), try getByText
        await this.page.getByText(cleanSelector).first().click();
      } else {
        // Use as CSS selector
        await this.page.locator(cleanSelector).first().click();
      }
      await this.page.waitForTimeout(500); // Wait for UI to update
    } catch (error: any) {
      throw new Error(`Failed to click selector "${selector}" (cleaned: "${cleanSelector}"): ${error.message}`);
    }
  }

  async input(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    
    try {
      if (selector.startsWith('text=')) {
        const textValue = selector.replace('text=', '').replace(/"/g, '');
        await this.page.getByText(textValue).first().fill(text);
      } else {
        await this.page.locator(selector).first().fill(text);
      }
      await this.page.waitForTimeout(300);
    } catch (error) {
      throw new Error(`Failed to input text to selector "${selector}": ${error}`);
    }
  }

  async getScreenshot(): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    const buffer = await this.page.screenshot({ fullPage: false });
    return buffer.toString('base64');
  }

  async getState(): Promise<BrowserState> {
    if (!this.page) throw new Error('Browser not initialized');
    return {
      url: this.page.url(),
      title: await this.page.title(),
      consoleErrors: [...this.consoleErrors],
      networkEntries: this.networkEntries.slice(-50), // Last 50 entries
      backendLogs: this.backendLogs.slice(-50) // Last 50 backend logs
    };
  }

  async getNetworkEntries(): Promise<NetworkEntry[]> {
    return this.networkEntries.slice(-100); // Last 100 entries
  }

  async stopTracing(path: string): Promise<void> {
    if (!this.context) throw new Error('Browser not initialized');
    this.tracingPath = path;
    await this.context.tracing.stop({ path });
  }

  async getVideoPath(): Promise<string | null> {
    if (!this.page) return null;
    return await this.page.video()?.path() || null;
  }

  async close(): Promise<void> {
    if (this.context && this.tracingPath) {
      await this.context.tracing.stop({ path: this.tracingPath });
    }
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }
}

