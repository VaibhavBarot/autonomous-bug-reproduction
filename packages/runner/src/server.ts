import express from 'express';
import cors from 'cors';
import { PlaywrightController } from './playwright-controller';
import { ClickAction, InputAction } from './types';

const app = express();
app.use(cors());
app.use(express.json());

const controller = new PlaywrightController();
let isInitialized = false;

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
    await controller.click(selector);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

