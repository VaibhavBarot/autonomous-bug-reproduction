import express from 'express';
import cors from 'cors';
import chalk from 'chalk';
import { PlaywrightController } from './playwright-controller';
import { ClickAction, InputAction } from './types';
import { spawn } from 'child_process';

const app = express();
app.use(cors());
app.use(express.json());

// Add request logging middleware for debugging
if (process.env.DEBUG_API || process.env.VERBOSE) {
  app.use((req, res, next) => {
    const start = Date.now();
    const timestamp = new Date().toISOString();
    console.error(chalk.cyan(`\n[${timestamp}] ${req.method} ${req.path}`));
    
    if (Object.keys(req.body || {}).length > 0) {
      console.error(chalk.gray(`   Body: ${JSON.stringify(req.body, null, 2)}`));
    }
    if (Object.keys(req.query || {}).length > 0) {
      console.error(chalk.gray(`   Query: ${JSON.stringify(req.query, null, 2)}`));
    }
    
    // Log response
    const originalSend = res.send;
    res.send = function(data) {
      const duration = Date.now() - start;
      const statusColor = res.statusCode >= 400 ? chalk.red : chalk.green;
      console.error(statusColor(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`));
      
      if (res.statusCode >= 400) {
        try {
          const errorData = typeof data === 'string' ? JSON.parse(data) : data;
          console.error(chalk.red(`   Error: ${JSON.stringify(errorData, null, 2)}`));
        } catch (e) {
          console.error(chalk.red(`   Error: ${data}`));
        }
      } else if (req.path === '/dom') {
        const domData = typeof data === 'string' ? JSON.parse(data) : data;
        console.error(chalk.gray(`   DOM elements returned: ${Array.isArray(domData) ? domData.length : 'N/A'}`));
      } else if (req.path === '/state') {
        const stateData = typeof data === 'string' ? JSON.parse(data) : data;
        console.error(chalk.gray(`   URL: ${stateData.url || 'N/A'}`));
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  });
}

const controller = new PlaywrightController();
let isInitialized = false;

// Backend log monitoring (independent of Playwright)
import CDP from 'chrome-remote-interface';
let backendLogs: string[] = [];
let cdpClient: any = null;

async function monitorBackendLogs() {
  try {
    cdpClient = await CDP({ port: 9229 });
    const { Runtime } = cdpClient;
    await Runtime.enable();
    Runtime.consoleAPICalled((payload: { type: string; args: Array<{ value: any }>; }) => {
      if (payload.type === 'error' || payload.type === 'warning' || payload.type === 'log') {
        const logMsg = payload.args.map((a: { value: any }) => a.value).join(' ');
        backendLogs.push(`[${payload.type}] ${logMsg}`);
      }
    });
    Runtime.exceptionThrown((payload: { exceptionDetails: { text: string } }) => {
      backendLogs.push(`[exception] ${payload.exceptionDetails.text}`);
    });
  } catch (err) {
    backendLogs.push(`[monitor error] ${err}`);
  }
}

monitorBackendLogs();
// Backend logs endpoint (does not require Playwright session)
app.get('/backend-logs', (req, res) => {
  res.json({ backendLogs: backendLogs.slice(-50) });
});

// Health check endpoint (doesn't require browser initialization)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', initialized: isInitialized });
});

// Initialize browser
app.post('/init', async (req, res) => {
  try {
    const { headless = false } = req.body;
    console.error(`[Server] Initializing browser (headless: ${headless})...`);
    await controller.initialize(headless);
    isInitialized = true;
    console.error(`[Server] Browser initialized successfully`);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Server] Browser initialization failed:`, error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Navigate to URL
app.post('/navigate', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { url } = req.body;
    await controller.navigate(url);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get simplified DOM
app.get('/dom', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const dom = await controller.getDOM();
    res.json(dom);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Click action
app.post('/action/click', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { selector }: ClickAction = req.body;
    console.error(`[Server] /action/click received selector: "${selector}"`);
    await controller.click(selector);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Server] /action/click error:`, error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Input action
app.post('/action/input', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { selector, text }: InputAction = req.body;
    await controller.input(selector, text);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get network entries
app.get('/network', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const entries = await controller.getNetworkEntries();
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get screenshot
app.get('/screenshot', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const screenshot = await controller.getScreenshot();
    res.json({ screenshot, format: 'base64' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get browser state
app.get('/state', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const state = await controller.getState();
    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stop tracing and get video path
app.post('/stop', async (req, res) => {
  try {
    if (!isInitialized) {
      return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
    }
    const { tracingPath } = req.body;
    await controller.stopTracing(tracingPath);
    const videoPath = await controller.getVideoPath();
    res.json({ success: true, videoPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Close browser
app.post('/close', async (req, res) => {
  try {
    await controller.close();
    isInitialized = false;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Linear webhook endpoint
app.post('/linear-webhook', async (req, res) => {
  try {
    const bugTitle = req.body.data?.title || 'No title';
    const bugDescription = req.body.data?.team?.description || bugTitle;
    console.log(`[Linear Webhook] Received bug: ${bugDescription}`);

    // Call BugBot orchestration function directly
    const { runBugBot } = require('../../api/src/run-bugbot');
    const config = {
      runnerUrl: 'http://localhost:3001',
      targetUrl: 'http://localhost:4200',
      bugDescription,
      maxSteps: 20,
      timeout: 300 * 1000,
      apiKey: process.env.GEMINI_API_KEY,
      provider: 'gemini',
      headless: false,
      verbose: false
    };
    try {
      await runBugBot(config);
      res.json({ success: true, received: bugDescription });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Runner server listening on port ${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please free the port or use a different one.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

export { app };

