import axios, { AxiosInstance } from 'axios';

export interface DaytonaSandbox {
  id: string;
  name?: string;
  state: string; // "started", "stopped", etc.
  desiredState?: string;
  language?: string;
  createdAt?: string;
}

export interface CreateSandboxRequest {
  language?: string;
  snapshotId?: string;
}

export interface CommandResult {
  output: string;
  exitCode: number;
  error?: string;
}

export class DaytonaClient {
  private client: AxiosInstance;
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
    
    // Daytona API base URL should already include /api
    // Example: https://app.daytona.io/api
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    });
  }

  /**
   * Create a sandbox from default snapshot
   */
  async createSandbox(language: string = 'typescript'): Promise<DaytonaSandbox> {
    try {
      const request: CreateSandboxRequest = { language };
      const response = await this.client.post('/sandbox', request);
      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to create Daytona sandbox: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Get sandbox status
   */
  async getSandboxStatus(sandboxId: string): Promise<DaytonaSandbox> {
    try {
      const response = await this.client.get(`/sandbox/${sandboxId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to get sandbox status: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Execute command in sandbox using toolbox API
   */
  async executeCommand(sandboxId: string, command: string, workingDir?: string): Promise<CommandResult> {
    try {
      // Try different possible endpoints for command execution
      const endpoints = [
        `/sandbox/${sandboxId}/toolbox/execute`,
        `/sandbox/${sandboxId}/exec`,
        `/sandbox/${sandboxId}/command`,
      ];

      let lastError: any;
      for (const endpoint of endpoints) {
        try {
          const response = await this.client.post(endpoint, {
            command,
            workingDirectory: workingDir,
          });
          
          return {
            output: response.data.output || response.data.stdout || '',
            exitCode: response.data.exitCode || 0,
          };
        } catch (error: any) {
          lastError = error;
          // Try next endpoint
        }
      }

      throw lastError;
    } catch (error: any) {
      throw new Error(
        `Failed to execute command: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Clone repository into sandbox using toolbox git API
   */
  async cloneRepository(
    sandboxId: string, 
    repoUrl: string, 
    branch: string = 'main',
    path: string = '/workspace'
  ): Promise<void> {
    try {
      // Try different possible endpoints for git clone
      const endpoints = [
        `/sandbox/${sandboxId}/toolbox/git/clone`,
        `/sandbox/${sandboxId}/git/clone`,
      ];

      let lastError: any;
      for (const endpoint of endpoints) {
        try {
          await this.client.post(endpoint, {
            url: repoUrl,
            branch,
            path,
          });
          return; // Success
        } catch (error: any) {
          lastError = error;
          // Try next endpoint
        }
      }

      // If API endpoints don't work, fallback to executing git command
      console.log('   Fallback: Using git command instead of API');
      await this.executeCommand(
        sandboxId,
        `git clone --branch ${branch} ${repoUrl} ${path}`
      );
    } catch (error: any) {
      throw new Error(
        `Failed to clone repository: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Download file from sandbox using toolbox API
   */
  async downloadFile(sandboxId: string, filePath: string): Promise<string> {
    try {
      // Try different possible endpoints for file download
      const endpoints = [
        `/sandbox/${sandboxId}/toolbox/file?path=${encodeURIComponent(filePath)}`,
        `/sandbox/${sandboxId}/file?path=${encodeURIComponent(filePath)}`,
        `/sandbox/${sandboxId}/files?path=${encodeURIComponent(filePath)}`,
      ];

      let lastError: any;
      for (const endpoint of endpoints) {
        try {
          const response = await this.client.get(endpoint);
          return typeof response.data === 'string' 
            ? response.data 
            : JSON.stringify(response.data);
        } catch (error: any) {
          lastError = error;
          // Try next endpoint
        }
      }

      // If API endpoints don't work, fallback to cat command
      console.log('   Fallback: Using cat command instead of API');
      const result = await this.executeCommand(sandboxId, `cat ${filePath}`);
      return result.output;
    } catch (error: any) {
      throw new Error(
        `Failed to download file: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Upload file to sandbox
   */
  async uploadFile(sandboxId: string, filePath: string, content: string): Promise<void> {
    try {
      // Try API endpoint first
      try {
        await this.client.post(`/sandbox/${sandboxId}/toolbox/file`, {
          path: filePath,
          content,
        });
        return;
      } catch {
        // Fallback to echo command
        console.log('   Fallback: Using echo command to write file');
        const escapedContent = content.replace(/'/g, "'\\''");
        await this.executeCommand(
          sandboxId,
          `echo '${escapedContent}' > ${filePath}`
        );
      }
    } catch (error: any) {
      throw new Error(
        `Failed to upload file: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Create directory in sandbox
   */
  async createDirectory(sandboxId: string, dirPath: string): Promise<void> {
    try {
      await this.executeCommand(sandboxId, `mkdir -p ${dirPath}`);
    } catch (error: any) {
      throw new Error(
        `Failed to create directory: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Check if file exists in sandbox
   */
  async fileExists(sandboxId: string, filePath: string): Promise<boolean> {
    try {
      const result = await this.executeCommand(sandboxId, `test -f ${filePath} && echo "exists" || echo "not found"`);
      return result.output.trim() === 'exists';
    } catch {
      return false;
    }
  }

  /**
   * Poll sandbox until it's ready
   */
  async waitForSandboxReady(
    sandboxId: string,
    maxWaitTime: number = 300000, // 5 minutes
    pollInterval: number = 5000 // 5 seconds
  ): Promise<DaytonaSandbox> {
    const startTime = Date.now();
    let pollCount = 0;

    while (Date.now() - startTime < maxWaitTime) {
      pollCount++;
      const sandbox = await this.getSandboxStatus(sandboxId);
      
      const currentState = sandbox.state;
      const desiredState = sandbox.desiredState || 'started';
      
      console.log(`⏳ Poll #${pollCount}: Sandbox state = "${currentState}", desiredState = "${desiredState}"`);

      // Check if sandbox is ready - "started" means it's running
      if (currentState === 'started' && desiredState === 'started') {
        console.log(`✅ Sandbox is ready with state: ${currentState}`);
        return sandbox;
      }

      // Check for error states
      if (currentState === 'error' || currentState === 'failed') {
        throw new Error(`Sandbox ${sandboxId} failed to start. State: ${currentState}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(
      `Sandbox ${sandboxId} did not become ready within ${maxWaitTime}ms`
    );
  }

  /**
   * Delete sandbox
   */
  async deleteSandbox(sandboxId: string): Promise<void> {
    try {
      await this.client.delete(`/sandbox/${sandboxId}`);
    } catch (error: any) {
      // Don't throw - cleanup failures shouldn't break the flow
      console.error(`Failed to delete sandbox ${sandboxId}:`, error.message);
    }
  }

  /**
   * Extract repository name from URL
   */
  extractRepoName(repoUrl: string): string {
    // Handle both https://github.com/owner/repo and git@github.com:owner/repo
    const match = repoUrl.match(/(?:github\.com[/:]|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) {
      return match[2]; // Just the repo name
    }
    return `repo-${Date.now()}`;
  }
}
