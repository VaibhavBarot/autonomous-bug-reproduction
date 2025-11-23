import { Page, Browser, chromium } from 'playwright';
import { Stagehand } from '@browserbasehq/stagehand';

export class StagehandController {
  private stagehand: Stagehand | null = null;
  private page: Page | null = null;
  private browser: Browser | null = null;
  private initialized: boolean = false;
  private cdpEndpoint: string | null = null;

  /**
   * Initialize Stagehand and create a browser that Playwright can connect to via CDP
   * Returns the CDP endpoint that Playwright should connect to
   */
  async initialize(apiKey?: string, modelProvider?: string, headless: boolean = false): Promise<string> {
    if (this.initialized) {
      return this.cdpEndpoint!;
    }
    
    try {
      // Initialize Stagehand with configuration
      const config: any = {
        env: 'LOCAL', // Use local browser, not Browserbase cloud
      };

      // Set up model provider based on available API key
      if (apiKey) {
        if (modelProvider === 'gemini' || process.env.GEMINI_API_KEY) {
          // Use Gemini model - Stagehand supports Google Gemini
          // Stagehand v3 uses format: "google/gemini-2.0-flash-exp" or "google/gemini-2.5-computer-use-preview-10-2025"
          // For computer use models (better for browser automation), use:
          config.model = 'google/gemini-2.5-flash';
          // For Gemini, Stagehand might use GOOGLE_API_KEY or GEMINI_API_KEY
          config.apiKey = apiKey;
          // Also set as GOOGLE_API_KEY for compatibility
          if (!process.env.GOOGLE_API_KEY) {
            process.env.GOOGLE_API_KEY = apiKey;
          }
          // Also set as GOOGLE_GENERATIVE_AI_API_KEY for Stagehand compatibility
          process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
          // Some Stagehand versions might need it in a different field
          (config as any).googleApiKey = apiKey;

          // Add Computer Use tool as required by Gemini API
          config.tools = config.tools || [];
          if (!config.tools.includes('computer_use')) {
            config.tools.push('computer_use');
          }
        } else {
          // Default to OpenAI
          config.model = 'openai/gpt-4o';
          config.apiKey = apiKey || process.env.OPENAI_API_KEY;
        }
      } else {
        // Try to use environment variables
        if (process.env.OPENAI_API_KEY) {
          config.model = 'openai/gpt-4o';
          config.apiKey = process.env.OPENAI_API_KEY;
        } else if (process.env.GEMINI_API_KEY) {
          config.model = 'google/gemini-2.5-flash';
          config.apiKey = process.env.GEMINI_API_KEY;
          (config as any).googleApiKey = process.env.GEMINI_API_KEY;
          if (!process.env.GOOGLE_API_KEY) {
            process.env.GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
          }
        }
      }
      
      console.log('[Stagehand] Config:', { 
        model: config.model, 
        hasApiKey: !!config.apiKey,
        provider: modelProvider,
        usingGemini: modelProvider === 'gemini' || !!process.env.GEMINI_API_KEY
      });

      // Initialize Stagehand - it will create and manage the browser
      this.stagehand = new Stagehand(config);
      await this.stagehand.init();
      
      // Get the CDP endpoint from Stagehand
      // This is the endpoint that Playwright will connect to
      this.cdpEndpoint = this.stagehand.connectURL();
      
      if (!this.cdpEndpoint) {
        throw new Error('Stagehand did not provide a CDP endpoint');
      }
      
      // Connect Playwright to Stagehand's browser via CDP
      this.browser = await chromium.connectOverCDP({
        wsEndpoint: this.cdpEndpoint,
      });
      
      // Get the page from the connected browser
      const contexts = this.browser.contexts();
      if (contexts.length > 0) {
        const pages = contexts[0].pages();
        if (pages.length > 0) {
          this.page = pages[0];
        } else {
          // Create a new page if none exists
          this.page = await contexts[0].newPage();
        }
      } else {
        // Create a new context and page if none exists
        const context = await this.browser.newContext();
        this.page = await context.newPage();
      }
      
      this.initialized = true;
      console.log('[Stagehand] Initialized successfully. Browser managed by Stagehand, Playwright connected via CDP.');
      return this.cdpEndpoint;
    } catch (error: any) {
      console.error('[Stagehand] Initialization error:', error);
      // Don't throw - allow system to work without Stagehand
      this.initialized = false;
      this.stagehand = null;
      this.browser = null;
      this.page = null;
      throw error; // Re-throw so caller knows it failed
    }
  }

  /**
   * Get the Playwright browser connected to Stagehand's browser
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Get the Playwright page connected to Stagehand's browser
   */
  getPage(): Page | null {
    return this.page;
  }

  async act(instruction: string): Promise<string> {
    if (!this.stagehand || !this.page || !this.initialized) {
      throw new Error('Stagehand not initialized. Make sure API key is provided.');
    }
    
    try {
      // Stagehand v3 API: pass page in options object
      // Now that we're connected via CDP, this should work
      const result = await this.stagehand.act(instruction, { page: this.page });
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error: any) {
      throw new Error(`Stagehand act() failed: ${error.message}`);
    }
  }

  async extract(instruction: string, schema?: any): Promise<any> {
    if (!this.stagehand || !this.page || !this.initialized) {
      throw new Error('Stagehand not initialized. Make sure API key is provided.');
    }
    
    try {
      // Stagehand v3 API: pass page in options object
      const result = await this.stagehand.extract(instruction, schema || {}, { page: this.page });
      return result;
    } catch (error: any) {
      throw new Error(`Stagehand extract() failed: ${error.message}`);
    }
  }

  async observe(): Promise<any> {
    if (!this.stagehand || !this.page || !this.initialized) {
      throw new Error('Stagehand not initialized. Make sure API key is provided.');
    }
    
    try {
      // Stagehand v3 API: pass page in options object
      const observations = await this.stagehand.observe({ page: this.page });
      return observations;
    } catch (error: any) {
      throw new Error(`Stagehand observe() failed: ${error.message}`);
    }
  }

  isInitialized(): boolean {
    return this.initialized && this.stagehand !== null;
  }

  async cleanup(): Promise<void> {
    // Close Playwright connection (but don't close Stagehand's browser - Stagehand manages it)
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        console.error('[Stagehand] Error closing Playwright browser connection:', error);
      }
    }
    
    // Cleanup Stagehand
    if (this.stagehand) {
      try {
        // Stagehand might have its own cleanup methods
        if (typeof (this.stagehand as any).close === 'function') {
          await (this.stagehand as any).close();
        }
      } catch (error) {
        console.error('[Stagehand] Cleanup error:', error);
      }
    }
    
    this.stagehand = null;
    this.browser = null;
    this.page = null;
    this.cdpEndpoint = null;
    this.initialized = false;
  }
}

