import axios from 'axios';
import { AgentWorkflow, LLMProvider } from '@bugbot/agent';
import { ArtifactManager } from './artifact-manager';
import { ReportGenerator, ReportData } from './report-generator';
import * as path from 'path';
import * as fs from 'fs-extra';
import chalk from 'chalk';

// Add axios interceptors for REST API debugging
if (process.env.DEBUG_API || process.env.VERBOSE) {
  axios.interceptors.request.use((config) => {
    console.log(chalk.cyan(`\n📤 API REQUEST: ${config.method?.toUpperCase()} ${config.url}`));
    if (config.data && Object.keys(config.data).length > 0) {
      console.log(chalk.gray(`   Body: ${JSON.stringify(config.data, null, 2)}`));
    }
    if (config.params && Object.keys(config.params).length > 0) {
      console.log(chalk.gray(`   Params: ${JSON.stringify(config.params, null, 2)}`));
    }
    return config;
  });

  axios.interceptors.response.use(
    (response) => {
      const dataPreview = typeof response.data === 'object' 
        ? JSON.stringify(response.data).substring(0, 200)
        : String(response.data).substring(0, 200);
      
      console.log(chalk.green(`📥 API RESPONSE: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`));
      return response;
    },
    (error) => {
      console.error(chalk.red(`❌ API ERROR: ${error.config?.method?.toUpperCase()} ${error.config?.url}`));
      return Promise.reject(error);
    }
  );
}

export interface OrchestratorConfig {
  runnerUrl: string;
  targetUrl: string;
  bugDescription: string;
  maxSteps: number;
  timeout: number;
  apiKey?: string;
  provider?: LLMProvider;
  headless?: boolean;
  verbose?: boolean;
}

export class Orchestrator {
  private config: OrchestratorConfig;
  private workflow: AgentWorkflow;
  private artifactManager: ArtifactManager;
  private runId: string;

  constructor(config: OrchestratorConfig, runId: string) {
    this.config = config;
    this.runId = runId;
    
    let modelName = 'gpt-4-turbo-preview';
    let baseUrl: string | undefined = undefined;

    if (config.provider === 'gemini') {
      modelName = 'gemini-2.5-flash';
      baseUrl = undefined; // Native Gemini client, no OpenAI-compatible base URL needed
    }

    this.workflow = new AgentWorkflow(
        config.runnerUrl, 
        modelName, 
        config.apiKey,
        baseUrl
    );
    this.artifactManager = new ArtifactManager(runId);
  }

  async initialize(): Promise<void> {
    await this.artifactManager.initialize();
    
    // Initialize browser
    try {
      const response = await axios.post(`${this.config.runnerUrl}/init`, {
        headless: this.config.headless ?? false
      });
      
      if (!response.data.success) {
        throw new Error('Browser initialization failed');
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      throw new Error(`Failed to initialize browser: ${errorMsg}. Make sure Playwright browsers are installed: npx playwright install chromium`);
    }

    // Navigate to target URL
    await axios.post(`${this.config.runnerUrl}/navigate`, {
      url: this.config.targetUrl
    });
  }

  async execute(): Promise<ReportData> {
    const startTime = new Date();
    let status: 'reproduced' | 'failed' | 'timeout' = 'failed';

    try {
      // Run the workflow
      const result = await this.workflow.run(this.config.bugDescription);
      
      // Determine status from report
      status = result.report.reproduced ? 'reproduced' : 'failed';

      // Capture final artifacts
      const artifacts = await this.artifactManager.initialize();
      
      // Stop tracing and get video path
      let videoPath = null;
      try {
          const stopResponse = await axios.post(`${this.config.runnerUrl}/stop`, {
            tracingPath: artifacts.tracingPath
          });
          videoPath = await this.artifactManager.copyVideo(stopResponse.data.videoPath);
      } catch (e) {
          console.warn("Failed to capture video/trace:", e);
      }

      // Save logs
      // Note: Console/Network logs were fetched by the analyzer, but we can fetch again or pass them if we want the full list.
      // For simplicity, let's fetch the current state again to save to disk.
      const [finalState, networkEntries] = await Promise.all([
        axios.get(`${this.config.runnerUrl}/state`).catch(() => ({ data: { consoleErrors: [] } })),
        axios.get(`${this.config.runnerUrl}/network`).catch(() => ({ data: [] }))
      ]);

      await this.artifactManager.saveNetworkHAR(networkEntries.data);
      await this.artifactManager.saveConsoleLogs(finalState.data.consoleErrors || []);

      // Map to ReportData
      const reportData: ReportData = {
        bugDescription: this.config.bugDescription,
        startTime,
        endTime: new Date(),
        status,
        steps: result.executionResults.map(step => ({
            stepNumber: step.stepNumber,
            action: {
                type: 'wait', // Placeholder type as we are abstracting actions
                selector: step.description,
                target: step.description
            },
            observation: step.detailedObservation ? {
                ...step.detailedObservation,
                // Ensure networkEntries is present as required by the type, defaulting to empty if not captured per step
                state: {
                    ...step.detailedObservation.state,
                    networkEntries: [] // Add missing property
                }
            } : {
                dom: [],
                state: { url: '', title: '', consoleErrors: [], networkEntries: [] }, // Add missing property
                stepNumber: step.stepNumber,
                screenshot: step.screenshot
            },
            thought: step.observation // Use the observation text as "thought" or detailed observation
        })),
        networkEntries: networkEntries.data,
        consoleErrors: finalState.data.consoleErrors || [],
        artifacts: {
          ...artifacts,
          videoPath
        }
      };

      // Save HTML report
      const htmlReport = ReportGenerator.generateHTML(reportData);
      await fs.writeFile(artifacts.reportPath, htmlReport);

      // Save Markdown report
      const mdReport = ReportGenerator.generateMarkdown(reportData);
      await fs.writeFile(
        path.join(artifacts.runDir, 'report.md'),
        mdReport
      );

      // Close browser
      await axios.post(`${this.config.runnerUrl}/close`).catch(() => {});

      return reportData;

    } catch (error: any) {
      console.error(`Orchestrator error: ${error.message}`);
      // Close browser just in case
      await axios.post(`${this.config.runnerUrl}/close`).catch(() => {});
      throw error;
    }
  }
}
