import { StructuredTool } from "@langchain/core/tools";
import axios from "axios";
import { z } from "zod";

export abstract class PlaywrightBaseTool extends StructuredTool {
  protected runnerUrl: string;

  constructor(runnerUrl: string) {
    super();
    this.runnerUrl = runnerUrl;
  }
}

export class NavigateTool extends PlaywrightBaseTool {
  name = "navigate";
  description = "Navigate to a specific URL";
  schema = z.object({
    url: z.string().describe("The URL to navigate to"),
  }) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: { url: string }): Promise<string> {
    try {
      await axios.post(`${this.runnerUrl}/navigate`, { url: input.url });
      return `Navigated to ${input.url}`;
    } catch (error: any) {
      return `Failed to navigate: ${error.message}`;
    }
  }
}

export class ClickTool extends PlaywrightBaseTool {
  name = "click";
  description = "Click on an element using a selector";
  schema = z.object({
    selector: z.string().describe("The selector of the element to click"),
  }) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: { selector: string }): Promise<string> {
    try {
      await axios.post(`${this.runnerUrl}/action/click`, { selector: input.selector });
      return `Clicked on ${input.selector}`;
    } catch (error: any) {
      return `Failed to click ${input.selector}: ${error.message}`;
    }
  }
}

export class InputTool extends PlaywrightBaseTool {
  name = "input";
  description = "Type text into an input field";
  schema = z.object({
    selector: z.string().describe("The selector of the input field"),
    text: z.string().describe("The text to type"),
  }) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: { selector: string; text: string }): Promise<string> {
    try {
      await axios.post(`${this.runnerUrl}/action/input`, {
        selector: input.selector,
        text: input.text,
      });
      return `Typed "${input.text}" into ${input.selector}`;
    } catch (error: any) {
      return `Failed to input text: ${error.message}`;
    }
  }
}

export class GetDOMTool extends PlaywrightBaseTool {
  name = "get_dom";
  description = "Get the current DOM structure (simplified for analysis)";
  schema = z.object({}) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: any): Promise<string> {
    try {
      const response = await axios.get(`${this.runnerUrl}/dom`);
      return JSON.stringify(response.data, null, 2);
    } catch (error: any) {
      return `Failed to get DOM: ${error.message}`;
    }
  }
}

export class GetStateTool extends PlaywrightBaseTool {
  name = "get_state";
  description = "Get the current browser state (URL, title, console errors)";
  schema = z.object({}) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: any): Promise<string> {
    try {
      const response = await axios.get(`${this.runnerUrl}/state`);
      return JSON.stringify(response.data, null, 2);
    } catch (error: any) {
      return `Failed to get state: ${error.message}`;
    }
  }
}

export class GetBackendLogsTool extends PlaywrightBaseTool {
  name = "get_backend_logs";
  description = "Get recent backend logs captured from the Node.js server (via DevTools)";
  schema = z.object({}) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: any): Promise<string> {
    try {
      const response = await axios.get(`${this.runnerUrl}/state`);
      const state = response.data || {};
      const logs: string[] = state.backendLogs || [];
      if (!logs.length) {
        return "No backend logs captured yet.";
      }
      return logs.join("\n");
    } catch (error: any) {
      return `Failed to get backend logs: ${error.message}`;
    }
  }
}

export class GetNetworkTool extends PlaywrightBaseTool {
  name = "get_network";
  description = "Get network activity logs";
  schema = z.object({}) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: any): Promise<string> {
    try {
      const response = await axios.get(`${this.runnerUrl}/network`);
      const summary = response.data.map((entry: any) => 
        `${entry.method} ${entry.url} - ${entry.status}`
      ).join('\n');
      return summary || "No network activity recorded.";
    } catch (error: any) {
      return `Failed to get network logs: ${error.message}`;
    }
  }
}

export class GetScreenshotTool extends PlaywrightBaseTool {
  name = "get_screenshot";
  description = "Capture a screenshot (returns base64)";
  schema = z.object({}) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: any): Promise<string> {
    try {
      const response = await axios.get(`${this.runnerUrl}/screenshot`);
      // Return raw base64 so the LLM can see the screenshot as an image input
      return response.data?.screenshot || "";
    } catch (error: any) {
      return `Failed to capture screenshot: ${error.message}`;
    }
  }
}
