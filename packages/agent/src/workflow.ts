import { PlannerAgent } from "./planner-agent";
import { ExecutorAgent, ExecutionStepResult } from "./executor-agent";
import { AnalyzerAgent, BugReport } from "./analyzer-agent";
import axios from "axios";

export interface WorkflowResult {
  plan: any;
  executionResults: ExecutionStepResult[];
  report: BugReport;
}

export class AgentWorkflow {
  private planner: PlannerAgent;
  private executor: ExecutorAgent;
  private analyzer: AnalyzerAgent;
  private runnerUrl: string;

  constructor(runnerUrl: string, modelName: string = "gemini-2.5-flash", apiKey?: string, _baseUrl?: string) {
    this.runnerUrl = runnerUrl;
    this.planner = new PlannerAgent(modelName, apiKey);
    this.executor = new ExecutorAgent(runnerUrl, modelName, apiKey);
    this.analyzer = new AnalyzerAgent(modelName, apiKey);
  }

  async run(bugDescription: string): Promise<WorkflowResult> {
    console.log("Starting Agent Workflow...");

    // Phase 1: Planning
    const plan = await this.planner.createPlan(bugDescription);
    console.log("Plan created with", plan.steps.length, "steps.");

    // Phase 2: Execution
    const executionResults = await this.executor.executePlan(plan);
    console.log("Execution completed.");

    // Gather artifacts for analysis (Console logs, Network logs)
    let consoleLogs: string[] = [];
    let networkLogs: any[] = [];
    try {
      const stateResponse = await axios.get(`${this.runnerUrl}/state`);
      consoleLogs = stateResponse.data.consoleErrors || [];
      
      const networkResponse = await axios.get(`${this.runnerUrl}/network`);
      networkLogs = networkResponse.data || [];
    } catch (e) {
      console.warn("Failed to fetch final logs for analysis:", e);
    }

    // Phase 3: Analysis
    const report = await this.analyzer.analyze(bugDescription, executionResults, consoleLogs, networkLogs);
    console.log("Analysis completed.");

    return {
      plan,
      executionResults,
      report
    };
  }
}

