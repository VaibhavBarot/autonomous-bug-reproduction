import axios from 'axios';
import { AgentWorkflow, LLMProvider } from '@bugbot/agent';
import { ArtifactManager } from './artifact-manager';
import { ReportGenerator, ReportData } from './report-generator';
import { DiagramGenerator } from './diagram-generator';
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
  useStagehand?: boolean;  // Enable/disable Stagehand (default: true if apiKey provided)
  stagehandApiKey?: string;  // Optional separate API key for Stagehand
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
      modelName = 'gemini-2.5-pro';
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
    
    // Determine if Stagehand should be used and get API key
    // Enable Stagehand by default when API key is provided
    const useStagehand = this.config.useStagehand !== false; // Default to true
    const stagehandApiKey = this.config.stagehandApiKey || (this.config.apiKey && useStagehand ? this.config.apiKey : undefined);
    const stagehandModelProvider = this.config.provider || 'gemini';
    
    if (useStagehand && stagehandApiKey) {
      console.log(chalk.cyan('🎭 Stagehand enabled - using AI-powered browser actions'));
    } else if (!stagehandApiKey) {
      console.log(chalk.yellow('⚠️  Stagehand disabled - no API key provided (will use legacy tools)'));
    }
    
    // Initialize browser with Stagehand if enabled
    try {
      const response = await axios.post(`${this.config.runnerUrl}/init`, {
        headless: this.config.headless ?? false,
        stagehandApiKey: stagehandApiKey,
        stagehandModelProvider: stagehandModelProvider
      });

      if (!response.data.success) {
        throw new Error('Browser initialization failed');
      }
      
      if (useStagehand && stagehandApiKey) {
        console.log('Stagehand enabled for smarter browser actions');
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
        steps: result.executionResults.map(step => {
            // Extract thought from observation string if thought field is not available
            let thought = step.thought;
            if (!thought && step.observation) {
                // Try to extract thought from observation string format: "Thought: ...\nTool: ..."
                const thoughtMatch = step.observation.match(/Thought:\s*(.+?)(?:\n|$)/);
                if (thoughtMatch) {
                    thought = thoughtMatch[1].trim();
                } else {
                    // If no match, use the full observation as fallback
                    thought = step.observation;
                }
            }
            
            return {
                stepNumber: step.stepNumber,
                action: {
                    type: 'wait', // Placeholder type as we are abstracting actions
                    selector: step.description,
                    target: step.description
                },
                observation: step.detailedObservation ? step.detailedObservation : {
                    dom: [],
                    state: { url: '', title: '', consoleErrors: [], networkEntries: [], backendLogs: [] },
                    stepNumber: step.stepNumber,
                    screenshot: step.screenshot
                },
                thought: thought
            };
        }),
        networkEntries: networkEntries.data,
        consoleErrors: finalState.data.consoleErrors || [],
        artifacts: {
          ...artifacts,
          videoPath
        }
      };

      // Generate architectural diagram
      try {
        const diagramGenerator = new DiagramGenerator(this.config.apiKey, this.config.provider);
        const diagram = await diagramGenerator.generateDiagram(reportData.steps);
        if (diagram) {
          reportData.diagram = diagram;
        }
      } catch (e) {
        console.warn(chalk.yellow('Failed to generate diagram:'), e);
      }


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
      await axios.post(`${this.config.runnerUrl}/close`).catch(() => { });

      return reportData;

    } catch (error: any) {
      console.error(`Orchestrator error: ${error.message}`);
      // Close browser just in case
      await axios.post(`${this.config.runnerUrl}/close`).catch(() => { });
      throw error;
    }
  }
}
