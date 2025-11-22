import { AgentObservation, AgentHistory } from './types';
export declare function buildPrompt(bugDescription: string, currentObservation: AgentObservation, history: AgentHistory): string;
