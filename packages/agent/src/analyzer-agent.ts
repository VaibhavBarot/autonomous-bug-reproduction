import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import { StructuredOutputParser } from "langchain/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { ExecutionStepResult } from "./executor-agent";

export const BugReportSchema = z.object({
  summary: z.string().describe("A brief summary of the reproduction attempt"),
  reproduced: z.boolean().describe("Whether the bug was successfully reproduced"),
  rootCauseAnalysis: z.string().describe("Analysis of why the bug occurred (Frontend/Backend/etc)"),
  stepsTaken: z.array(z.string()).describe("List of steps actually performed"),
  recommendation: z.string().describe("Suggested fix or next steps"),
});

export type BugReport = z.infer<typeof BugReportSchema>;

export class AnalyzerAgent {
  private model: ChatGoogleGenerativeAI;

  constructor(modelName: string = "gemini-2.5-flash", apiKey?: string) {
    const config: any = {
      model: modelName,
      temperature: 0,
    };
    if (apiKey) config.apiKey = apiKey;

    this.model = new ChatGoogleGenerativeAI(config);
  }

  async analyze(
    bugDescription: string, 
    executionResults: ExecutionStepResult[],
    consoleLogs: string[] = [],
    networkLogs: any[] = []
  ): Promise<BugReport> {
    const parser = StructuredOutputParser.fromZodSchema(BugReportSchema as any);
    
    const prompt = PromptTemplate.fromTemplate(
      `You are a Technical QA Analyst. Analyze the results of a bug reproduction test.
      
      BUG DESCRIPTION:
      {bugDescription}
      
      EXECUTION LOGS:
      {executionLogs}
      
      CONSOLE LOGS:
      {consoleLogs}
      
      NETWORK ACTIVITY SUMMARY:
      {networkLogs}
      
      Determine if the bug was reproduced. 
      If reproduced, analyze the root cause (e.g., frontend error, backend 500, network failure).
      
      {format_instructions}`
    );

    const executionLogString = executionResults.map(step => 
      `Step ${step.stepNumber}: ${step.description} - Status: ${step.status}\nObservation: ${step.observation}`
    ).join('\n\n');

    // Simple network log summary (stringified if necessary)
    const networkLogString = typeof networkLogs === 'string' ? networkLogs : 
      (Array.isArray(networkLogs) ? networkLogs.slice(0, 20).map(n => `${n.method} ${n.url} ${n.status}`).join('\n') : 'No network logs');

    try {
      console.log("Analyzing reproduction results...");
      const formattedPrompt = await prompt.format({
        bugDescription,
        executionLogs: executionLogString,
        consoleLogs: consoleLogs.join('\n'),
        networkLogs: networkLogString,
        format_instructions: parser.getFormatInstructions(),
      });

      const llmResult: any = await (this.model as any).invoke(formattedPrompt);
      const text =
        Array.isArray(llmResult.content) && llmResult.content.length > 0
          ? (llmResult.content[0] as any).text ?? JSON.stringify(llmResult.content[0])
          : (llmResult.text ?? JSON.stringify(llmResult));

      const parsed = await parser.parse(text);
      return parsed as BugReport;
    } catch (error) {
      console.error("Error analyzing results:", error);
      // Fallback report
      return {
        summary: "Analysis failed due to LLM error.",
        reproduced: executionResults.some(r => r.status === "failed" && r.observation.toLowerCase().includes("reproduced")),
        rootCauseAnalysis: "Unknown (Analysis failed)",
        stepsTaken: executionResults.map(r => r.description),
        recommendation: "Check raw logs manually."
      };
    }
  }
}
