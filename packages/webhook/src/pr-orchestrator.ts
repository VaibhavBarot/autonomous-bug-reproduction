// This file is deprecated in the new implementation
// The PR handler now directly manages the testing workflow
// This file is kept for backward compatibility but is no longer used

export interface PRTestConfig {
  workspaceId: string;
  userAppPath?: string;
  userAppStartCommand?: string;
  userAppPort?: number;
  bugDescription: string;
  maxSteps: number;
  timeout: number;
  apiKey?: string;
  provider?: 'gemini' | 'openai';
  headless?: boolean;
}

export interface PRTestResult {
  success: boolean;
  reportPath: string;
  reportContent: string;
  error?: string;
}

// Deprecated - functionality moved to PR handler
export class PROrchestrator {
  constructor(_daytona: any, _config: PRTestConfig) {
    throw new Error('PROrchestrator is deprecated. Use PRHandler directly.');
  }
}
