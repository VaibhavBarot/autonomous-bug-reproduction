import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { DOMElement, NetworkEntry, BrowserState } from './types';
import { extractSimplifiedDOM } from './dom-simplifier';
import * as fs from 'fs';
import * as path from 'path';
import CDP from 'chrome-remote-interface';

// NO SELF-IMPORT HERE

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
    await this.close(); 
    this.networkEntries = [];
    this.consoleErrors = [];
    this.tracingPath = null;
    this.backendLogs = [];
    this.cdpClient = null;

    try {
      this.browser = await chromium.launch({ 
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
      });
    } catch (error: any) {
      if (error.message.includes('Executable doesn\'t exist') || error.message.includes('BrowserType')) {
        throw new Error('Chromium browser not installed. Run: npx playwright install chromium');
      }
      throw error;
    }
    
    try {
      const videoDir = path.join(process.cwd(), 'runs', 'videos');
      if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
      
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } }
      });
    } catch (error: any) {
      if (this.browser) await this.browser.close();
      throw new Error(`Failed to create browser context: ${error.message}`);
    }
    this.page = await this.context.newPage();

    this.page.on('console', (msg) => {
      if (msg.type() === 'error') this.consoleErrors.push(msg.text());
    });

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

    await this.context.tracing.start({ screenshots: true, snapshots: true });
    await this.monitorBackendLogs();
  }

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
      this.cdpClient = null;
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
    let cleanSelector = selector ? selector.trim() : '';
    const originalSelector = selector;
    
    // Robust cleanup logic
    try {
      if (cleanSelector.includes(' or ')) {
        const parts = cleanSelector.split(/\s+or\s+/);
        let lastPart = parts[parts.length - 1]?.trim() || '';
        lastPart = lastPart.replace(/^["']|["']$/g, '');
        if (lastPart.startsWith('text=')) {
          cleanSelector = lastPart.replace(/^text\s*=\s*/, '').replace(/^["']|["']$/g, '');
        } else {
          cleanSelector = lastPart;
        }
      }
      
      // Safety fallback if cleanup left complex string
      if (cleanSelector.includes(' or ') || cleanSelector.includes('text=') || (cleanSelector.includes('=') && !cleanSelector.startsWith('#'))) {
        const match = cleanSelector.match(/text\s*=\s*["']([^"']+)["']/) || 
                      cleanSelector.match(/["']([A-Za-z0-9\s]+)["']/);
        if (match && match[1]) cleanSelector = match[1];
      }
    } catch (e) {
      cleanSelector = originalSelector; 
    }
    
    try {
      if (cleanSelector.startsWith('text=')) {
        const text = cleanSelector.replace('text=', '').replace(/["']/g, '').trim();
        await this.page.getByText(text, { exact: false }).first().click();
      } else if (!cleanSelector.includes('[') && !cleanSelector.includes('#') && !cleanSelector.includes('.')) {
         // Assume plain text
         await this.page.getByText(cleanSelector, { exact: false }).first().click();
      } else {
         await this.page.locator(cleanSelector).first().click();
      }
      await this.page.waitForTimeout(500);
    } catch (error: any) {
      throw new Error(`Failed to click "${originalSelector}": ${error.message}`);
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
      throw new Error(`Failed to input text: ${error}`);
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
      networkEntries: this.networkEntries.slice(-50), 
      backendLogs: this.backendLogs.slice(-50)
    };
  }

  async getNetworkEntries(): Promise<NetworkEntry[]> {
    return this.networkEntries.slice(-100); 
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
    if (this.page) { try { await this.page.close(); } catch {} this.page = null; }
    if (this.context) { try { await this.context.close(); } catch {} this.context = null; }
    if (this.browser) { try { await this.browser.close(); } catch {} this.browser = null; }
    if (this.cdpClient) { try { await this.cdpClient.close(); } catch {} this.cdpClient = null; }
    this.tracingPath = null;
  }

  static async globalCleanup(controller?: PlaywrightController) {
    if (controller) await controller.close();
  }

  static async forceStop(controller?: PlaywrightController) {
    if (controller) await controller.close();
    process.exit(0);
  }
}