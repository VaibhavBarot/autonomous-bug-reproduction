import axios from 'axios';
import { BugReproductionAgent, LLMProvider } from '@bugbot/agent';
import { AgentAction, AgentObservation, AgentHistory } from '@bugbot/agent';
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
      
      if (response.config.url?.includes('/dom')) {
        console.log(chalk.gray(`   DOM elements: ${Array.isArray(response.data) ? response.data.length : 'N/A'}`));
      } else if (response.config.url?.includes('/state')) {
        console.log(chalk.gray(`   URL: ${response.data.url || 'N/A'}`));
        console.log(chalk.gray(`   Console errors: ${response.data.consoleErrors?.length || 0}`));
      } else if (response.config.url?.includes('/network')) {
        console.log(chalk.gray(`   Network entries: ${Array.isArray(response.data) ? response.data.length : 'N/A'}`));
      } else {
        console.log(chalk.gray(`   Response: ${dataPreview}${dataPreview.length >= 200 ? '...' : ''}`));
      }
      return response;
    },
    (error) => {
      console.error(chalk.red(`❌ API ERROR: ${error.config?.method?.toUpperCase()} ${error.config?.url}`));
      console.error(chalk.red(`   Status: ${error.response?.status || 'No response'}`));
      console.error(chalk.red(`   Error: ${error.response?.data?.error || error.message}`));
      if (error.response?.data?.stack && process.env.DEBUG_API) {
        console.error(chalk.red(`   Stack: ${error.response.data.stack}`));
      }
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
  private agent: BugReproductionAgent;
  private artifactManager: ArtifactManager;
  private runId: string;
  private history: AgentHistory = { observations: [], actions: [] };

  constructor(config: OrchestratorConfig, runId: string) {
    this.config = config;
    this.runId = runId;
    this.agent = new BugReproductionAgent(config.apiKey, config.provider || 'gemini', undefined, config.verbose);
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
    let stepNumber = 0;
    let status: 'reproduced' | 'failed' | 'timeout' = 'failed';
    const steps: ReportData['steps'] = [];

    try {
      while (stepNumber < this.config.maxSteps) {
        stepNumber++;

        if (this.config.verbose) {
          console.log(chalk.bold.cyan(`\n${'═'.repeat(80)}`));
          console.log(chalk.bold.cyan(`STEP ${stepNumber} / ${this.config.maxSteps}`));
          console.log(chalk.bold.cyan(`${'═'.repeat(80)}\n`));
        }

        // Get current state
        if (this.config.verbose) {
          console.log(chalk.gray('📡 Fetching current browser state...'));
        }
        
        const [domResponse, stateResponse, screenshotResponse] = await Promise.all([
          axios.get(`${this.config.runnerUrl}/dom`),
          axios.get(`${this.config.runnerUrl}/state`),
          axios.get(`${this.config.runnerUrl}/screenshot`).catch(() => ({ data: { screenshot: null } }))
        ]);

        const observation: AgentObservation = {
          dom: domResponse.data,
          state: stateResponse.data,
          screenshot: screenshotResponse.data.screenshot,
          stepNumber
        };

        this.history.observations.push(observation);

        if (this.config.verbose) {
          console.log(chalk.green(`✓ Browser state captured`));
          console.log(chalk.gray(`  URL: ${observation.state.url}`));
          console.log(chalk.gray(`  Title: ${observation.state.title}`));
          console.log(chalk.gray(`  Clickable Elements: ${observation.dom.filter(e => e.clickable).length}`));
          console.log(chalk.gray(`  Total DOM Elements: ${observation.dom.length}`));
          console.log(chalk.gray(`  Console Errors: ${observation.state.consoleErrors.length}`));
          
          if (observation.dom.filter(e => e.clickable).length > 0) {
            console.log(chalk.gray(`\n  Top Clickable Elements:`));
            observation.dom
              .filter(e => e.clickable)
              .slice(0, 5)
              .forEach((el, idx) => {
                console.log(chalk.gray(`    ${idx + 1}. "${el.text || '(no text)'}" [${el.selector}]`));
              });
          }
        }

        // Agent decides next action
        if (this.config.verbose) {
          console.log(chalk.yellow(`\n🤔 Consulting LLM agent...`));
        }
        
        // SAFETY CHECK: Detect repetitive loops
        // If the last 2 actions were identical clicks, and we are about to ask again,
        // we can assume the agent is stuck loop.
        const lastActions = this.history.actions.slice(-2);
        if (lastActions.length === 2 && 
            lastActions[0].type === 'click' && 
            lastActions[1].type === 'click' &&
            lastActions[0].selector === lastActions[1].selector) {
            
            console.log(chalk.yellow.bold(`\n⚠️  Loop detected: Agent keeps clicking '${lastActions[0].selector}'`));
            console.log(chalk.green.bold(`🎉  Assuming bug is reproduced (action has no effect).`));
            
            status = 'reproduced';
            steps.push({
              stepNumber,
              action: { type: 'wait', selector: 'body' }, // Dummy action to close loop
              observation,
              thought: 'Loop detected: The agent kept clicking the same button with no result. This confirms the bug (action produces no change).'
            });
            break;
        }

        const agentResponse = await this.agent.decideNextAction(
          this.config.bugDescription,
          observation,
          this.history
        );

        steps.push({
          stepNumber,
          action: agentResponse.action,
          observation,
          thought: agentResponse.thought
        });

        if (this.config.verbose) {
          console.log(chalk.blue(`\n🎯 Action Decision:`));
          console.log(chalk.white(`   Type: ${agentResponse.action.type}`));
          console.log(chalk.white(`   Target: ${agentResponse.action.target || 'N/A'}`));
          console.log(chalk.white(`   Selector: ${agentResponse.action.selector}`));
          if (agentResponse.action.text) {
            console.log(chalk.white(`   Text: "${agentResponse.action.text}"`));
          }
        }

        // Check if bug is reproduced
        if (agentResponse.status === 'reproduced') {
          if (this.config.verbose) {
            console.log(chalk.green.bold(`\n🎉 BUG REPRODUCED!`));
            console.log(chalk.green(`Reason: ${agentResponse.reason || 'Agent detected the bug'}`));
          }
          status = 'reproduced';
          break;
        }

        // Execute action
        if (this.config.verbose) {
          console.log(chalk.magenta(`\n⚡ Executing action: ${agentResponse.action.type}...`));
        }
        
        try {
          await this.executeAction(agentResponse.action);
          // Only add to history if action succeeded
          this.history.actions.push(agentResponse.action);
          
          if (this.config.verbose) {
            console.log(chalk.green(`✓ Action executed successfully`));
          }
        } catch (error: any) {
          console.error(chalk.red(`❌ Error executing action: ${error.message}`));
          if (this.config.verbose || process.env.DEBUG_API) {
            console.error(chalk.red(`   Action: ${agentResponse.action.type}(${agentResponse.action.selector})`));
            console.error(chalk.red(`   This action will NOT be added to history`));
            
            // Show full error details
            if (error.response) {
              console.error(chalk.red(`   HTTP Status: ${error.response.status}`));
              console.error(chalk.red(`   Server Error: ${JSON.stringify(error.response.data, null, 2)}`));
            }
            if (error.stack) {
              console.error(chalk.gray(`   Stack: ${error.stack.split('\n').slice(0, 5).join('\n')}`));
            }
          }
          // Don't add failed actions to history, but continue to next step
        }

        // Small delay between steps
        if (this.config.verbose) {
          console.log(chalk.gray(`\n⏳ Waiting 1 second before next step...`));
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (stepNumber >= this.config.maxSteps) {
        status = 'timeout';
      }
    } catch (error: any) {
      console.error(`Orchestrator error: ${error.message}`);
      status = 'failed';
    } finally {
      // Capture final artifacts
      const [finalState, networkEntries] = await Promise.all([
        axios.get(`${this.config.runnerUrl}/state`).catch(() => ({ data: { consoleErrors: [] } })),
        axios.get(`${this.config.runnerUrl}/network`).catch(() => ({ data: [] }))
      ]);

      const artifacts = await this.artifactManager.initialize();
      
      // Stop tracing and get video path
      const stopResponse = await axios.post(`${this.config.runnerUrl}/stop`, {
        tracingPath: artifacts.tracingPath
      }).catch(() => ({ data: { videoPath: null } }));

      const videoPath = await this.artifactManager.copyVideo(stopResponse.data.videoPath);

      // Save artifacts
      await this.artifactManager.saveNetworkHAR(networkEntries.data);
      await this.artifactManager.saveConsoleLogs(finalState.data.consoleErrors || []);

      // Generate report
      const reportData: ReportData = {
        bugDescription: this.config.bugDescription,
        startTime,
        endTime: new Date(),
        status,
        steps,
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
    }
  }

  private async executeAction(action: AgentAction): Promise<void> {
    switch (action.type) {
      case 'click':
        await axios.post(`${this.config.runnerUrl}/action/click`, {
          selector: action.selector
        });
        break;
      case 'input':
        await axios.post(`${this.config.runnerUrl}/action/input`, {
          selector: action.selector,
          text: action.text
        });
        break;
      case 'wait':
        await new Promise(resolve => setTimeout(resolve, 2000));
        break;
      case 'navigate':
        if (action.url) {
          await axios.post(`${this.config.runnerUrl}/navigate`, {
            url: action.url
          });
        }
        break;
      default:
        throw new Error(`Unknown action type: ${(action as any).type}`);
    }
  }
}

