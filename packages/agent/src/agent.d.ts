import { AgentObservation, AgentHistory, AgentResponse } from './types';
export declare class BugReproductionAgent {
    private client;
    private model;
    constructor(apiKey?: string, model?: string);
    decideNextAction(bugDescription: string, observation: AgentObservation, history: AgentHistory): Promise<AgentResponse>;
    checkIfReproduced(bugDescription: string, observation: AgentObservation, history: AgentHistory): Promise<boolean>;
}
