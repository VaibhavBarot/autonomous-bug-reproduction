import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { 
  NavigateTool, 
  ClickTool, 
  InputTool, 
  GetDOMTool, 
  GetStateTool, 
  GetScreenshotTool, 
  GetNetworkTool,
  GetBackendLogsTool
} from "./tools/playwright-tools";
import {
  StagehandActTool,
  StagehandExtractTool,
  StagehandObserveTool
} from "./tools/stagehand-tools";
import { TestPlan } from "./planner-agent";
import { AgentObservation } from "./types";

export interface ExecutionStepResult {
  stepNumber: number;
  description: string;
  status: "passed" | "failed";
  observation: string;
  screenshot?: string;
  detailedObservation?: AgentObservation;
}

export class ExecutorAgent {
  private model: ChatGoogleGenerativeAI;
  private runnerUrl: string;

  constructor(runnerUrl: string, modelName: string = "gemini-2.5-flash", apiKey?: string, _baseUrl?: string) {
    this.runnerUrl = runnerUrl;

    const config: any = {
      model: modelName,
      temperature: 0,
    };
    if (apiKey) config.apiKey = apiKey;

    this.model = new ChatGoogleGenerativeAI(config);
  }

  async executePlan(plan: TestPlan): Promise<ExecutionStepResult[]> {
    const results: ExecutionStepResult[] = [];

    for (const step of plan.steps) {
      console.log(`\nExecuting Step ${step.stepNumber}: ${step.description}`);

      try {
        // Tools for this step
        const domTool = new GetDOMTool(this.runnerUrl);
        const stateTool = new GetStateTool(this.runnerUrl);
        const screenshotTool = new GetScreenshotTool(this.runnerUrl);
        const networkTool = new GetNetworkTool(this.runnerUrl);
        const backendLogsTool = new GetBackendLogsTool(this.runnerUrl);
        const navigateTool = new NavigateTool(this.runnerUrl);
        
        // Stagehand tools for smarter actions (preferred)
        const stagehandActTool = new StagehandActTool(this.runnerUrl);
        const stagehandExtractTool = new StagehandExtractTool(this.runnerUrl);
        const stagehandObserveTool = new StagehandObserveTool(this.runnerUrl);
        
        // Legacy tools (fallback if Stagehand not available)
        const clickTool = new ClickTool(this.runnerUrl);
        const inputTool = new InputTool(this.runnerUrl);

        // Fetch current state before action for context and reporting
        const currentDOMStr = await domTool._call({});
        const currentStateStr = await stateTool._call({});
        const currentNetworkStr = await networkTool._call({});
        
        // Try to get Stagehand observations (available actions on the page)
        let observationsStr = "";
        let stagehandAvailable = false;
        try {
          const obsResult = await stagehandObserveTool._call({});
          // Check if we got actual observations or an error message
          if (!obsResult.includes("not available") && !obsResult.includes("Failed") && !obsResult.includes("Cannot use")) {
            observationsStr = obsResult;
            stagehandAvailable = true;
          } else {
            observationsStr = "Stagehand not available - use legacy tools (click, input, get_dom)";
          }
        } catch (e) {
          // Stagehand might not be initialized, that's okay
          observationsStr = "Stagehand not available - use legacy tools (click, input, get_dom)";
        }

        let currentDOM: any[] = [];
        let currentState: any = { url: "", title: "", consoleErrors: [] };

        // Only attempt JSON parse if the tools returned JSON, not an error string
        if (!currentDOMStr.startsWith("Failed")) {
          try {
            currentDOM = JSON.parse(currentDOMStr);
          } catch (e) {
            console.warn("Failed to parse DOM JSON", e);
          }
        } else {
          console.warn("GetDOMTool returned error text, skipping DOM JSON parse:", currentDOMStr);
        }

        if (!currentStateStr.startsWith("Failed")) {
          try {
            currentState = JSON.parse(currentStateStr);
          } catch (e) {
            console.warn("Failed to parse State JSON", e);
          }
        } else {
          console.warn("GetStateTool returned error text, skipping State JSON parse:", currentStateStr);
        }

        const toolPrompt = `
You are an autonomous QA execution agent using tools to interact with a web page.

Bug description:
${step.description}

Current planned step:
${step.description}

Expected outcome:
${step.expectedOutcome}

Current simplified DOM (FULL JSON array of elements):
${currentDOMStr}

Current state:
${currentStateStr}

Recent network activity (may be truncated by the server, but include as much as available):
${currentNetworkStr}

Available actions on the page (from Stagehand observe - use this to understand what's possible):
${observationsStr}

Choose ONE best tool to move this step forward.

${stagehandAvailable ? `**Stagehand Tools (AVAILABLE - use these for smarter actions):**
- "stagehand_act" with args { "instruction": "<natural language action>" }
- "stagehand_extract" with args { "instruction": "<what to extract>" }
- "stagehand_observe" with args {} to refresh observations

**Legacy Tools (fallback if Stagehand unavailable):**
- "navigate" with args { "url": "<url>" }
- "click" with args { "selector": "<locator or text>" }
- "input" with args { "selector": "<input selector>", "text": "<text>" }
- "get_backend_logs" with args {}
- "noop" if no action needed` : `**IMPORTANT: Stagehand is NOT available. You MUST use legacy tools:**
- "navigate" with args { "url": "<url>" } - for navigation
- "click" with args { "selector": "<locator or visible text>" } - for clicking elements
  Example selectors: "Add to Cart", "button:text('Add to Cart')", "#cart-button"
- "input" with args { "selector": "<input selector>", "text": "<text>" } - for typing
- "get_dom" - to see page elements (already provided above in currentDOMStr)
- "get_backend_logs" with args {} - to inspect backend logs
- "noop" if no action needed

**Decision Guidelines:**
- Use "click" with text-based selectors like "Add to Cart" or button text
- Use "get_dom" data (already provided) to find the right selectors
- Parse the DOM to extract data instead of using stagehand_extract`}

Return ONLY valid JSON in this exact format (no extra commentary before or after, no markdown):
{
  "thought": "reason about what to do",
  "tool": "stagehand_act" | "stagehand_extract" | "stagehand_observe" | "navigate" | "click" | "input" | "get_backend_logs" | "noop",
  "args": { ... appropriate args ... }
}`;

        // Capture screenshot for reporting (but current Gemini model does not support image inputs)
        const screenshotBase64 = await screenshotTool._call({});

        const llmResult: any = await (this.model as any).invoke(toolPrompt);
        const rawText =
          Array.isArray(llmResult.content) && llmResult.content.length > 0
            ? (llmResult.content[0] as any).text ?? JSON.stringify(llmResult.content[0])
            : (llmResult.text ?? JSON.stringify(llmResult));

        let parsed: any;
        try {
          const firstBrace = rawText.indexOf("{");
          const lastBrace = rawText.lastIndexOf("}");
          const jsonText =
            firstBrace !== -1 && lastBrace !== -1
              ? rawText.slice(firstBrace, lastBrace + 1)
              : rawText;
          parsed = JSON.parse(jsonText);
        } catch (e) {
          console.warn("Failed to parse executor JSON, treating output as observation only:", rawText);
          const screenshot = await screenshotTool._call({});
          results.push({
            stepNumber: step.stepNumber,
            description: step.description,
            status: "failed",
            observation: rawText,
            screenshot: screenshot.includes("hidden") ? undefined : screenshot,
            detailedObservation: {
              dom: currentDOM,
              state: currentState,
              screenshot: screenshot.includes("hidden") ? undefined : screenshot,
              stepNumber: step.stepNumber,
            },
          });
          continue;
        }

        const toolName = parsed.tool as string;
        const args = parsed.args || {};
        let toolObservation = "";

        try {
          if (toolName === "stagehand_act") {
            toolObservation = await stagehandActTool._call({ instruction: args.instruction });
          } else if (toolName === "stagehand_extract") {
            toolObservation = await stagehandExtractTool._call({ 
              instruction: args.instruction,
              schema: args.schema
            });
          } else if (toolName === "stagehand_observe") {
            toolObservation = await stagehandObserveTool._call({});
          } else if (toolName === "navigate") {
            toolObservation = await navigateTool._call({ url: args.url });
          } else if (toolName === "click") {
            toolObservation = await clickTool._call({ selector: args.selector });
          } else if (toolName === "input") {
            toolObservation = await inputTool._call({
              selector: args.selector,
              text: args.text,
            });
          } else if (toolName === "get_backend_logs") {
            toolObservation = await backendLogsTool._call({});
          } else {
            toolObservation = "No action taken (noop).";
          }
        } catch (toolError: any) {
          toolObservation = `Tool execution error: ${toolError.message || String(toolError)}`;
        }

        // Reuse the same screenshot we already captured, if available;
        // otherwise, fall back to capturing a fresh one.
        const screenshot =
          screenshotBase64 && !screenshotBase64.startsWith("Failed")
            ? screenshotBase64
            : await screenshotTool._call({});

        const detailedObservation: AgentObservation = {
          dom: currentDOM,
          state: currentState,
          screenshot: screenshot.includes("hidden") ? undefined : screenshot,
          stepNumber: step.stepNumber,
        };

        const combinedObservation = `Thought: ${parsed.thought}\nTool: ${toolName}\nTool Observation: ${toolObservation}`;

        const status: ExecutionStepResult["status"] =
          combinedObservation.toLowerCase().includes("fail") ||
          combinedObservation.toLowerCase().includes("error")
            ? "failed"
            : "passed";

        results.push({
          stepNumber: step.stepNumber,
          description: step.description,
          status,
          observation: combinedObservation,
          screenshot: screenshot.includes("hidden") ? undefined : screenshot,
          detailedObservation,
        });
      } catch (error: any) {
        console.error(`Error executing step ${step.stepNumber}:`, error);
        results.push({
          stepNumber: step.stepNumber,
          description: step.description,
          status: "failed",
          observation: `System error executing step: ${error.message}`,
        });
      }
    }

    return results;
  }
}
