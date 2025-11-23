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
    const originalSelector = selector;

    // SPECIAL CASE: If this is an explicit Playwright "xpath=" selector,
    // use it directly with locator and DO NOT try to parse it as text.
    if (cleanSelector.startsWith('xpath=')) {
      console.error(`[Click] Detected explicit xpath selector, using locator directly: "${cleanSelector}"`);
      try {
        await this.page.locator(cleanSelector).first().click();
        await this.page.waitForTimeout(500);
        console.error(`[Click] Successfully clicked xpath selector: "${cleanSelector}"`);
        return;
      } catch (error: any) {
        console.error(`[Click] Error clicking xpath selector:`, error);
        throw new Error(`Failed to click xpath selector "${originalSelector}": ${error.message}`);
      }
    }
    
    // Handle selectors like "button or text="Add to Cart"" or 'button or text="Add to Cart"'
    if (cleanSelector.includes(' or ')) {
      // Split by " or " and take the last part
      const parts = cleanSelector.split(/\s+or\s+/);
      if (parts.length >= 2) {
        let lastPart = parts[parts.length - 1].trim();
        console.error(`[Click] Last part before cleaning: "${lastPart}"`);
        
        // Remove outer quotes if present
        lastPart = lastPart.replace(/^["']|["']$/g, '');
        
        // If it starts with text=, extract everything after text=" or text='
        if (lastPart.startsWith('text=')) {
          // Remove text= prefix
          let textValue = lastPart.replace(/^text\s*=\s*/, '');
          // Remove quotes around the value
          textValue = textValue.replace(/^["']|["']$/g, '');
          cleanSelector = textValue;
          console.error(`[Click] Extracted from text= pattern: "${cleanSelector}"`);
        } else {
          // Use the last part as-is (should be the text)
          cleanSelector = lastPart;
          console.error(`[Click] Using last part after "or": "${cleanSelector}"`);
        }
      } else {
        // Fallback: try to extract text="..." pattern directly
        const textMatch = cleanSelector.match(/text\s*=\s*["']([^"']+)["']/);
        if (textMatch && textMatch[1]) {
          cleanSelector = textMatch[1];
          console.error(`[Click] Extracted text from text= pattern: "${cleanSelector}"`);
        } else {
          // Try to find any quoted text
          const quotedMatch = cleanSelector.match(/["']([^"']+)["']/);
          if (quotedMatch && quotedMatch[1]) {
            cleanSelector = quotedMatch[1];
            console.error(`[Click] Extracted quoted text: "${cleanSelector}"`);
          }
        }
      }
    }
    
    console.error(`[Click] Original selector: "${originalSelector}"`);
    console.error(`[Click] Cleaned selector (after first pass): "${cleanSelector}"`);
    
    // Final safety check: if cleaned selector still contains " or " or looks like a complex selector,
    // try to extract just the text part more aggressively
    if (cleanSelector.includes(' or ') || cleanSelector.includes('text=') || (cleanSelector.includes('=') && !cleanSelector.startsWith('#'))) {
      console.error(`[Click] Selector still contains problematic patterns, attempting aggressive extraction...`);
      
      // Try to extract text from text="..." pattern more aggressively
      const aggressiveMatch = cleanSelector.match(/text\s*=\s*["']([^"']+)["']/);
      if (aggressiveMatch && aggressiveMatch[1]) {
        cleanSelector = aggressiveMatch[1];
        console.error(`[Click] Aggressive extraction from text=: "${cleanSelector}"`);
      } else {
        // Try to find any quoted text that looks like button text
        const quotedParts = cleanSelector.match(/["']([A-Za-z0-9\s]+)["']/g);
        if (quotedParts && quotedParts.length > 0) {
          // Take the longest quoted text (likely the button text)
          const longest = quotedParts.reduce((a, b) => a.length > b.length ? a : b);
          cleanSelector = longest.replace(/["']/g, '');
          console.error(`[Click] Using longest quoted text: "${cleanSelector}"`);
        } else {
          // Last resort: extract text after "or" or after "="
          const afterOr = cleanSelector.split(/\s+or\s+/).pop() || '';
          const afterEquals = cleanSelector.split('=').pop() || '';
          // Take whichever is longer and looks more like button text
          const candidate1 = afterOr.replace(/^["']|["']$/g, '').trim();
          const candidate2 = afterEquals.replace(/^["']|["']$/g, '').trim();
          cleanSelector = candidate1.length > candidate2.length ? candidate1 : candidate2;
          console.error(`[Click] Using text after "or" or "=": "${cleanSelector}"`);
        }
      }
    }
    
    console.error(`[Click] Final cleaned selector: "${cleanSelector}"`);
    
    try {
      // Try different selector strategies in order of preference
      
      // 1. If it's just plain text (no special characters), use getByText
      if (!cleanSelector.includes('[') && 
          !cleanSelector.includes('(') && 
          !cleanSelector.startsWith('.') && 
          !cleanSelector.startsWith('#') && 
          !cleanSelector.startsWith('text=') &&
          !cleanSelector.includes('getByRole') &&
          !cleanSelector.includes(' or ') &&
          !cleanSelector.includes('=')) {
        console.error(`[Click] Using getByText with: "${cleanSelector}"`);
        await this.page.getByText(cleanSelector, { exact: false }).first().click();
      }
      // 2. If it starts with text=, extract and use getByText
      else if (cleanSelector.startsWith('text=')) {
        const text = cleanSelector.replace('text=', '').replace(/"/g, '').replace(/'/g, '').trim();
        console.error(`[Click] Using getByText (from text=): "${text}"`);
        await this.page.getByText(text, { exact: false }).first().click();
      }
      // 3. If it's quoted text, extract and use getByText
      else if (cleanSelector.match(/^["']([^"']+)["']$/)) {
        const text = cleanSelector.replace(/["']/g, '');
        console.error(`[Click] Using getByText (from quotes): "${text}"`);
        await this.page.getByText(text, { exact: false }).first().click();
      }
      // 4. If it contains getByRole, parse it
      else if (cleanSelector.includes('getByRole')) {
        const match = cleanSelector.match(/getByRole\(['"]([^'"]+)['"],\s*\{\s*name:\s*['"]([^'"]+)['"]\s*\}\)/);
        if (match) {
          console.error(`[Click] Using getByRole: role="${match[1]}", name="${match[2]}"`);
          await this.page.getByRole(match[1] as any, { name: match[2] }).click();
        } else {
          console.error(`[Click] Using locator (getByRole fallback): "${cleanSelector}"`);
          await this.page.locator(cleanSelector).first().click();
        }
      }
      // 5. If selector still contains problematic patterns, try getByText as fallback
      else if (cleanSelector.includes(' or ') || cleanSelector.includes('text=') || cleanSelector.includes('=')) {
        // Last resort: try to extract any text that looks like button text
        // First try to find quoted text
        let textMatch = cleanSelector.match(/["']([A-Za-z0-9\s]+)["']/);
        if (!textMatch) {
          // Try without quotes - look for text after = or after "or"
          textMatch = cleanSelector.match(/=\s*["']?([A-Za-z][A-Za-z0-9\s]{2,})["']?/) || 
                     cleanSelector.match(/or\s+["']?([A-Za-z][A-Za-z0-9\s]{2,})["']?/);
        }
        if (textMatch && textMatch[1]) {
          const fallbackText = textMatch[1].trim();
          console.error(`[Click] Fallback: Using getByText with extracted text: "${fallbackText}"`);
          await this.page.getByText(fallbackText, { exact: false }).first().click();
        } else {
          // Ultimate fallback: try to use getByRole with button
          console.error(`[Click] Ultimate fallback: Trying getByRole('button') with text matching`);
          // Extract any alphanumeric text from the selector
          const anyText = cleanSelector.match(/([A-Za-z][A-Za-z0-9\s]{3,})/);
          if (anyText && anyText[1]) {
            const buttonText = anyText[1].trim();
            console.error(`[Click] Trying getByRole('button', { name: "${buttonText}" })`);
            await this.page.getByRole('button', { name: buttonText, exact: false }).first().click();
          } else {
            throw new Error(`Cannot parse selector: "${originalSelector}" (cleaned: "${cleanSelector}"). Please use a simpler selector format.`);
          }
        }
      }
      // 6. Default: use as CSS selector with locator - BUT ONLY if it's a valid CSS selector
      else {
        // Check if it looks like a valid CSS selector before using locator
        if (cleanSelector.includes('=') || cleanSelector.includes(' or ')) {
          // This shouldn't happen, but if it does, throw an error
          throw new Error(`Invalid selector format: "${originalSelector}". Cannot use as CSS selector.`);
        }
        console.error(`[Click] Using locator (CSS selector): "${cleanSelector}"`);
        await this.page.locator(cleanSelector).first().click();
      }
      
      await this.page.waitForTimeout(500); // Wait for UI to update
      console.error(`[Click] Successfully clicked: "${cleanSelector}"`);
    } catch (error: any) {
      console.error(`[Click] Error details:`, error);
      throw new Error(`Failed to click selector "${originalSelector}" (cleaned: "${cleanSelector}"): ${error.message}`);
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

