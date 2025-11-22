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
}

export interface ClickAction {
  selector: string;
}

export interface InputAction {
  selector: string;
  text: string;
}

