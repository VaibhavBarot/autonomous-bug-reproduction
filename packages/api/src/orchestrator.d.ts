import { ReportData } from './report-generator';
export interface OrchestratorConfig {
    runnerUrl: string;
    targetUrl: string;
    bugDescription: string;
    maxSteps: number;
    timeout: number;
    openaiApiKey?: string;
    headless?: boolean;
}
export declare class Orchestrator {
    private config;
    private agent;
    private artifactManager;
    private runId;
    private history;
    constructor(config: OrchestratorConfig, runId: string);
    initialize(): Promise<void>;
    execute(): Promise<ReportData>;
    private executeAction;
}
