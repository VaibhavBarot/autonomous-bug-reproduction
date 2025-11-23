import express from 'express';
import cors from 'cors';
import chalk from 'chalk';
import { PlaywrightController } from './playwright-controller';
import { ClickAction, InputAction } from './types';
import CDP from 'chrome-remote-interface'; 

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
    
    const originalSend = res.send;
    res.send = function(data) {
      const duration = Date.now() - start;
      const statusColor = res.statusCode >= 400 ? chalk.red : chalk.green;
      console.error(statusColor(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`));
      return originalSend.call(this, data);
    };
    
    next();
  });
}

const controller = new PlaywrightController();
let isInitialized = false;

// Backend log monitoring
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

app.get('/backend-logs', (req, res) => {
  res.json({ backendLogs: backendLogs.slice(-50) });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', initialized: isInitialized });
});

app.post('/init', async (req, res) => {
  try {
    const { headless = false } = req.body;
    console.error(`[Server] Initializing browser (headless: ${headless})...`);
    await controller.initialize(headless);
    isInitialized = true;
    console.log(`[Server] Browser initialized successfully`);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Server] Browser initialization failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/navigate', async (req, res) => {
  try {
    if (!isInitialized) return res.status(400).json({ error: 'Browser not initialized' });
    const { url } = req.body;
    await controller.navigate(url);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/dom', async (req, res) => {
  try {
    if (!isInitialized) return res.status(400).json({ error: 'Browser not initialized' });
    const dom = await controller.getDOM();
    res.json(dom);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/action/click', async (req, res) => {
  try {
    if (!isInitialized) return res.status(400).json({ error: 'Browser not initialized' });
    const { selector }: ClickAction = req.body;
    console.error(`[Server] /action/click received selector: "${selector}"`);
    await controller.click(selector);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Server] /action/click error:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/action/input', async (req, res) => {
  try {
    if (!isInitialized) return res.status(400).json({ error: 'Browser not initialized' });
    const { selector, text }: InputAction = req.body;
    await controller.input(selector, text);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/network', async (req, res) => {
  try {
    if (!isInitialized) return res.status(400).json({ error: 'Browser not initialized' });
    const entries = await controller.getNetworkEntries();
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/screenshot', async (req, res) => {
  try {
    if (!isInitialized) return res.status(400).json({ error: 'Browser not initialized' });
    const screenshot = await controller.getScreenshot();
    res.json({ screenshot, format: 'base64' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/state', async (req, res) => {
  try {
    if (!isInitialized) return res.status(400).json({ error: 'Browser not initialized' });
    const state = await controller.getState();
    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/stop', async (req, res) => {
  try {
    if (!isInitialized) return res.status(400).json({ error: 'Browser not initialized' });
    const { tracingPath } = req.body;
    await controller.stopTracing(tracingPath);
    const videoPath = await controller.getVideoPath();
    res.json({ success: true, videoPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Explicit Close Endpoint (Manual Shutdown)
app.post('/close', async (req, res) => {
  try {
    console.log('[Server] Received close command. Cleaning up resources...');
    await controller.close();
    if (cdpClient) {
      try { await cdpClient.close(); } catch {}
    }
    isInitialized = false;
    res.json({ success: true });
    
    // Force exit process to prevent server hanging
    console.log('[Server] Shutting down process in 100ms...');
    setTimeout(() => {
      console.log('🛑 Server exiting now.');
      process.exit(0);
    }, 100);

  } catch (error: any) {
    console.error('[Server] Error during close:', error);
    res.status(500).json({ error: error.message });
    // Still exit on error to prevent zombies
    setTimeout(() => process.exit(1), 100);
  }
});

// Linear Webhook (Internal Run)
app.post('/linear-webhook', async (req, res) => {
  try {
    const bugTitle = req.body.data?.title || 'No title';
    const bugDescription = req.body.data?.team?.description || bugTitle;
    console.log(`[Linear Webhook] Received bug: ${bugDescription}`);

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
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
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