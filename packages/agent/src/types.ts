import { DOMElement, BrowserState } from '@bugbot/runner';

export interface AgentAction {
  type: 'click' | 'input' | 'wait' | 'navigate' | 'query_database';
  target?: string;
  selector: string;
  text?: string;
  url?: string;
  // Database query fields
  dbQuery?: {
    collection: string;
    operation: 'find' | 'findOne' | 'aggregate' | 'getSchema' | 'listCollections';
    query?: any;
    pipeline?: any[];
    options?: any;
  };
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
  // Database query results from previous step
  dbQueryResult?: any;
}

export interface AgentHistory {
  observations: AgentObservation[];
  actions: AgentAction[];
}

export interface DatabaseContext {
  collections?: string[];
  lastQueryResult?: any;
}

