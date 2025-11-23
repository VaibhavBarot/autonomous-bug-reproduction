import { StructuredTool } from "@langchain/core/tools";
import axios from "axios";
import { z } from "zod";

export abstract class StagehandBaseTool extends StructuredTool {
  protected runnerUrl: string;

  constructor(runnerUrl: string) {
    super();
    this.runnerUrl = runnerUrl;
  }
}

export class StagehandActTool extends StagehandBaseTool {
  name = "stagehand_act";
  description = "Perform a browser action using natural language. Use this instead of manual click/input when you want Stagehand to intelligently find and interact with elements. Examples: 'click the Add to Cart button for Product 2', 'type my email in the login form', 'click the submit button'. Stagehand will automatically find the right element even if the page structure changes.";
  schema = z.object({
    instruction: z.string().describe("Natural language instruction for the action to perform. Be specific and descriptive."),
  }) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: { instruction: string }): Promise<string> {
    try {
      const response = await axios.post(`${this.runnerUrl}/action/act`, {
        instruction: input.instruction
      });
      return `Action completed successfully: ${response.data.result || 'success'}`;
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      // If Stagehand is not available, return a message that will prompt agent to use legacy tools
      if (error.response?.data?.stagehandError) {
        return `Stagehand is not available: ${errorMsg}. Please use the legacy 'click' or 'input' tools instead.`;
      }
      return `Failed to perform action: ${errorMsg}`;
    }
  }
}

export class StagehandExtractTool extends StagehandBaseTool {
  name = "stagehand_extract";
  description = "Extract data from the page using natural language. Examples: 'get the price of the first product', 'extract all product names and prices', 'get the current cart count number'. Returns structured data that can be used for reasoning.";
  schema = z.object({
    instruction: z.string().describe("Natural language instruction for what data to extract. Be specific about what you want to extract."),
    schema: z.any().optional().describe("Optional schema for structured extraction (usually not needed, Stagehand handles this automatically)"),
  }) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: { instruction: string; schema?: any }): Promise<string> {
    try {
      const response = await axios.post(`${this.runnerUrl}/extract`, {
        instruction: input.instruction,
        schema: input.schema
      });
      const data = response.data.data;
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      if (error.response?.data?.stagehandError) {
        return `Stagehand is not available: ${errorMsg}. Please use the legacy 'get_dom' tool to parse the DOM instead.`;
      }
      return `Failed to extract data: ${errorMsg}`;
    }
  }
}

export class StagehandObserveTool extends StagehandBaseTool {
  name = "stagehand_observe";
  description = "Get a list of available actions and elements on the current page. Use this to understand what's possible before deciding on an action. This helps you see what buttons, links, and interactive elements are available. Call this when you need to explore what actions are possible on the current page.";
  schema = z.object({}) as any;

  constructor(runnerUrl: string) {
    super(runnerUrl);
  }

  async _call(input: any): Promise<string> {
    try {
      const response = await axios.get(`${this.runnerUrl}/observe`);
      const observations = response.data.observations || [];
      // If observations is empty, return a helpful message
      if (Array.isArray(observations) && observations.length === 0) {
        return "No observations available (Stagehand may not be initialized). Use get_dom tool to see page elements.";
      }
      return typeof observations === 'string' 
        ? observations 
        : JSON.stringify(observations, null, 2);
    } catch (error: any) {
      // If observe fails, return empty observations so agent can continue
      return "No observations available (Stagehand may not be initialized). Use get_dom tool to see page elements.";
    }
  }
}

