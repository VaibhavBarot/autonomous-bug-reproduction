"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const axios_1 = __importDefault(require("axios"));
const agent_1 = require("@bugbot/agent");
const artifact_manager_1 = require("./artifact-manager");
const report_generator_1 = require("./report-generator");
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
class Orchestrator {
    config;
    agent;
    artifactManager;
    runId;
    history = { observations: [], actions: [] };
    constructor(config, runId) {
        this.config = config;
        this.runId = runId;
        this.agent = new agent_1.BugReproductionAgent(config.openaiApiKey);
        this.artifactManager = new artifact_manager_1.ArtifactManager(runId);
    }
    async initialize() {
        await this.artifactManager.initialize();
        // Initialize browser
        await axios_1.default.post(`${this.config.runnerUrl}/init`, {
            headless: this.config.headless ?? false
        });
        // Navigate to target URL
        await axios_1.default.post(`${this.config.runnerUrl}/navigate`, {
            url: this.config.targetUrl
        });
    }
    async execute() {
        const startTime = new Date();
        let stepNumber = 0;
        let status = 'failed';
        const steps = [];
        try {
            while (stepNumber < this.config.maxSteps) {
                stepNumber++;
                // Get current state
                const [domResponse, stateResponse, screenshotResponse] = await Promise.all([
                    axios_1.default.get(`${this.config.runnerUrl}/dom`),
                    axios_1.default.get(`${this.config.runnerUrl}/state`),
                    axios_1.default.get(`${this.config.runnerUrl}/screenshot`).catch(() => ({ data: { screenshot: null } }))
                ]);
                const observation = {
                    dom: domResponse.data,
                    state: stateResponse.data,
                    screenshot: screenshotResponse.data.screenshot,
                    stepNumber
                };
                this.history.observations.push(observation);
                // Agent decides next action
                const agentResponse = await this.agent.decideNextAction(this.config.bugDescription, observation, this.history);
                steps.push({
                    stepNumber,
                    action: agentResponse.action,
                    observation,
                    thought: agentResponse.thought
                });
                // Check if bug is reproduced
                if (agentResponse.status === 'reproduced') {
                    status = 'reproduced';
                    break;
                }
                // Execute action
                try {
                    await this.executeAction(agentResponse.action);
                    this.history.actions.push(agentResponse.action);
                }
                catch (error) {
                    console.error(`Error executing action: ${error.message}`);
                    // Continue to next step
                }
                // Small delay between steps
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (stepNumber >= this.config.maxSteps) {
                status = 'timeout';
            }
        }
        catch (error) {
            console.error(`Orchestrator error: ${error.message}`);
            status = 'failed';
        }
        finally {
            // Capture final artifacts
            const [finalState, networkEntries] = await Promise.all([
                axios_1.default.get(`${this.config.runnerUrl}/state`).catch(() => ({ data: { consoleErrors: [] } })),
                axios_1.default.get(`${this.config.runnerUrl}/network`).catch(() => ({ data: [] }))
            ]);
            const artifacts = await this.artifactManager.initialize();
            // Stop tracing and get video path
            const stopResponse = await axios_1.default.post(`${this.config.runnerUrl}/stop`, {
                tracingPath: artifacts.tracingPath
            }).catch(() => ({ data: { videoPath: null } }));
            const videoPath = await this.artifactManager.copyVideo(stopResponse.data.videoPath);
            // Save artifacts
            await this.artifactManager.saveNetworkHAR(networkEntries.data);
            await this.artifactManager.saveConsoleLogs(finalState.data.consoleErrors || []);
            // Generate report
            const reportData = {
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
            const htmlReport = report_generator_1.ReportGenerator.generateHTML(reportData);
            await fs.writeFile(artifacts.reportPath, htmlReport);
            // Save Markdown report
            const mdReport = report_generator_1.ReportGenerator.generateMarkdown(reportData);
            await fs.writeFile(path.join(artifacts.runDir, 'report.md'), mdReport);
            // Close browser
            await axios_1.default.post(`${this.config.runnerUrl}/close`).catch(() => { });
            return reportData;
        }
    }
    async executeAction(action) {
        switch (action.type) {
            case 'click':
                await axios_1.default.post(`${this.config.runnerUrl}/action/click`, {
                    selector: action.selector
                });
                break;
            case 'input':
                await axios_1.default.post(`${this.config.runnerUrl}/action/input`, {
                    selector: action.selector,
                    text: action.text
                });
                break;
            case 'wait':
                await new Promise(resolve => setTimeout(resolve, 2000));
                break;
            case 'navigate':
                if (action.url) {
                    await axios_1.default.post(`${this.config.runnerUrl}/navigate`, {
                        url: action.url
                    });
                }
                break;
            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }
}
exports.Orchestrator = Orchestrator;
