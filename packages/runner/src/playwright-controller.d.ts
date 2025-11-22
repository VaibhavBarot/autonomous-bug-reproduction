import { DOMElement, NetworkEntry, BrowserState } from './types';
export declare class PlaywrightController {
    private browser;
    private context;
    private page;
    private networkEntries;
    private consoleErrors;
    private tracingPath;
    initialize(headless?: boolean): Promise<void>;
    navigate(url: string): Promise<void>;
    getDOM(): Promise<DOMElement[]>;
    click(selector: string): Promise<void>;
    input(selector: string, text: string): Promise<void>;
    getScreenshot(): Promise<string>;
    getState(): Promise<BrowserState>;
    getNetworkEntries(): Promise<NetworkEntry[]>;
    stopTracing(path: string): Promise<void>;
    getVideoPath(): Promise<string | null>;
    close(): Promise<void>;
}
