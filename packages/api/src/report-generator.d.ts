import { ArtifactPaths } from './artifact-manager';
import { AgentAction, AgentObservation } from '@bugbot/agent';
import { NetworkEntry } from '@bugbot/runner';
export interface ReportData {
    bugDescription: string;
    startTime: Date;
    endTime: Date;
    status: 'reproduced' | 'failed' | 'timeout';
    steps: Array<{
        stepNumber: number;
        action: AgentAction;
        observation: AgentObservation;
        thought?: string;
    }>;
    networkEntries: NetworkEntry[];
    consoleErrors: string[];
    artifacts: ArtifactPaths;
}
export declare class ReportGenerator {
    static generateHTML(data: ReportData): string;
    static generateMarkdown(data: ReportData): string;
    private static escapeHtml;
}
