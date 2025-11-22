"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightController = void 0;
const playwright_1 = require("playwright");
const dom_simplifier_1 = require("./dom-simplifier");
class PlaywrightController {
    browser = null;
    context = null;
    page = null;
    networkEntries = [];
    consoleErrors = [];
    tracingPath = null;
    async initialize(headless = false) {
        this.browser = await playwright_1.chromium.launch({ headless });
        this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 720 },
            recordVideo: {
                dir: './runs/videos/',
                size: { width: 1280, height: 720 }
            }
        });
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
    }
    async navigate(url) {
        if (!this.page)
            throw new Error('Browser not initialized');
        await this.page.goto(url, { waitUntil: 'networkidle' });
    }
    async getDOM() {
        if (!this.page)
            throw new Error('Browser not initialized');
        return await (0, dom_simplifier_1.extractSimplifiedDOM)(this.page);
    }
    async click(selector) {
        if (!this.page)
            throw new Error('Browser not initialized');
        try {
            // Try different selector strategies
            if (selector.startsWith('text=')) {
                const text = selector.replace('text=', '').replace(/"/g, '');
                await this.page.getByText(text).first().click();
            }
            else if (selector.includes('getByRole')) {
                // Extract role and name from selector like "getByRole('button', { name: 'Add' })"
                const match = selector.match(/getByRole\(['"]([^'"]+)['"],\s*\{\s*name:\s*['"]([^'"]+)['"]\s*\}\)/);
                if (match) {
                    await this.page.getByRole(match[1], { name: match[2] }).click();
                }
                else {
                    await this.page.locator(selector).click();
                }
            }
            else {
                await this.page.locator(selector).first().click();
            }
            await this.page.waitForTimeout(500); // Wait for UI to update
        }
        catch (error) {
            throw new Error(`Failed to click selector "${selector}": ${error}`);
        }
    }
    async input(selector, text) {
        if (!this.page)
            throw new Error('Browser not initialized');
        try {
            if (selector.startsWith('text=')) {
                const textValue = selector.replace('text=', '').replace(/"/g, '');
                await this.page.getByText(textValue).first().fill(text);
            }
            else {
                await this.page.locator(selector).first().fill(text);
            }
            await this.page.waitForTimeout(300);
        }
        catch (error) {
            throw new Error(`Failed to input text to selector "${selector}": ${error}`);
        }
    }
    async getScreenshot() {
        if (!this.page)
            throw new Error('Browser not initialized');
        const buffer = await this.page.screenshot({ fullPage: false });
        return buffer.toString('base64');
    }
    async getState() {
        if (!this.page)
            throw new Error('Browser not initialized');
        return {
            url: this.page.url(),
            title: await this.page.title(),
            consoleErrors: [...this.consoleErrors],
            networkEntries: this.networkEntries.slice(-50) // Last 50 entries
        };
    }
    async getNetworkEntries() {
        return this.networkEntries.slice(-100); // Last 100 entries
    }
    async stopTracing(path) {
        if (!this.context)
            throw new Error('Browser not initialized');
        this.tracingPath = path;
        await this.context.tracing.stop({ path });
    }
    async getVideoPath() {
        if (!this.page)
            return null;
        return await this.page.video()?.path() || null;
    }
    async close() {
        if (this.context && this.tracingPath) {
            await this.context.tracing.stop({ path: this.tracingPath });
        }
        if (this.context)
            await this.context.close();
        if (this.browser)
            await this.browser.close();
    }
}
exports.PlaywrightController = PlaywrightController;
