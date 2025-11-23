export interface DOMElement {
  text: string;
  role?: string;
  xpath: string;
  clickable: boolean;
  selector: string;
  tagName: string;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  timestamp: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export interface BrowserState {
  url: string;
  title: string;
  consoleErrors: string[];
  networkEntries: NetworkEntry[];
  backendLogs: string[];
}

export interface ClickAction {
  selector: string;
}

export interface InputAction {
  selector: string;
  text: string;
}

export interface StagehandActAction {
  instruction: string;  // Natural language instruction like "click the Add to Cart button"
}

export interface StagehandExtractAction {
  instruction: string;  // Natural language extraction like "get the price of the first product"
  schema?: any;  // Optional schema for structured extraction
}

