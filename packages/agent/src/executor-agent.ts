import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { 
  NavigateTool, 
  ClickTool, 
  InputTool, 
  GetDOMTool, 
  GetStateTool, 
  GetScreenshotTool, 
  GetNetworkTool 
} from "./tools/playwright-tools";
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
        const navigateTool = new NavigateTool(this.runnerUrl);
        const clickTool = new ClickTool(this.runnerUrl);
        const inputTool = new InputTool(this.runnerUrl);

        // Fetch current state before action for context and reporting
        const currentDOMStr = await domTool._call({});
        const currentStateStr = await stateTool._call({});
        const currentNetworkStr = await networkTool._call({});

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

Choose ONE best tool to move this step forward:
- "navigate" with args { "url": "<url>" }
- "click" with args { "selector": "<locator or visible text>" }
- "input" with args { "selector": "<input selector>", "text": "<text to type>" }
- "noop" if no action is needed (verification only).

Return ONLY valid JSON in this exact format (no extra commentary before or after, no markdown):
{
  "thought": "reason about what to do",
  "tool": "navigate" | "click" | "input" | "noop",
  "args": { ... appropriate args ... }
}`;

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
          if (toolName === "navigate") {
            toolObservation = await navigateTool._call({ url: args.url });
          } else if (toolName === "click") {
            toolObservation = await clickTool._call({ selector: args.selector });
          } else if (toolName === "input") {
            toolObservation = await inputTool._call({
              selector: args.selector,
              text: args.text,
            });
          } else {
            toolObservation = "No action taken (noop).";
          }
        } catch (toolError: any) {
          toolObservation = `Tool execution error: ${toolError.message || String(toolError)}`;
        }

        const screenshot = await screenshotTool._call({});

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
