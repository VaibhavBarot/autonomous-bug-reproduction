import { DOMElement, BrowserState } from '@bugbot/runner';

export interface AgentAction {
  type: 'click' | 'input' | 'wait' | 'navigate';
  target?: string;
  selector: string;
  text?: string;
  url?: string;
}

export interface AgentResponse {
  thought: string;
  action: AgentAction;
  status?: 'reproduced' | 'failed' | 'in_progress';
  reason?: string;
}

export interface AgentObservation {
  dom: DOMElement[];
  state: BrowserState;
  screenshot?: string;
  stepNumber: number;
}

export interface AgentHistory {
  observations: AgentObservation[];
  actions: AgentAction[];
}

