"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const playwright_controller_1 = require("./playwright-controller");
const app = (0, express_1.default)();
exports.app = app;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const controller = new playwright_controller_1.PlaywrightController();
let isInitialized = false;
// Initialize browser
app.post('/init', async (req, res) => {
    try {
        const { headless = false } = req.body;
        await controller.initialize(headless);
        isInitialized = true;
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
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
    }
    catch (error) {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Click action
app.post('/action/click', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
        }
        const { selector } = req.body;
        await controller.click(selector);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Input action
app.post('/action/input', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(400).json({ error: 'Browser not initialized. Call /init first.' });
        }
        const { selector, text } = req.body;
        await controller.input(selector, text);
        res.json({ success: true });
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Close browser
app.post('/close', async (req, res) => {
    try {
        await controller.close();
        isInitialized = false;
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
const PORT = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Runner server listening on port ${PORT}`);
    });
}
