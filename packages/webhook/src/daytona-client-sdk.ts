import { Daytona } from '@daytonaio/sdk';

export interface DaytonaSandbox {
  id: string;
  name?: string;
  state: string;
  desiredState?: string;
  language?: string;
  createdAt?: string;
}

export interface CommandResult {
  output: string;
  exitCode: number;
  error?: string;
}

export class DaytonaClient {
  private client: Daytona;
  private apiUrl: string;
  private apiKey: string;
  private sandboxCache: Map<string, any> = new Map(); // Cache created sandboxes

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    
    // Initialize Daytona SDK
    this.client = new Daytona({
      apiKey: apiKey,
      apiUrl: apiUrl,
    });
  }

  /**
   * Create a sandbox from default snapshot
   */
  async createSandbox(language: string = 'typescript'): Promise<any> {
    try {
      console.log(`   Creating sandbox with language: ${language}`);
      const sandbox = await this.client.create({
        language: language,
      });
      
      console.log(`   Sandbox created with ID: ${sandbox.id}`);
      
      // Cache the sandbox object for later use
      this.sandboxCache.set(sandbox.id, sandbox);
      
      return sandbox;
    } catch (error: any) {
      throw new Error(
        `Failed to create Daytona sandbox: ${error.message}`
      );
    }
  }

  /**
   * Get sandbox object (for SDK operations)
   */
  async getSandbox(sandboxId: string): Promise<any> {
    try {
      // SDK sandboxes are accessed directly via the client
      return { id: sandboxId, _client: this.client };
    } catch (error: any) {
      throw new Error(
        `Failed to get sandbox: ${error.message}`
      );
    }
  }

  /**
   * Get sandbox status
   */
  async getSandboxStatus(sandboxId: string): Promise<any> {
    try {
      // SDK sandboxes are ready when created
      // Just return a simple status object
      return {
        id: sandboxId,
        state: 'started',
      };
    } catch (error: any) {
      throw new Error(
        `Failed to get sandbox status: ${error.message}`
      );
    }
  }

  /**
   * Execute command in sandbox using SDK
   */
  async executeCommand(sandboxId: string, command: string, workingDir?: string): Promise<CommandResult> {
    try {
      console.log(`   Executing: ${command}`);
      if (workingDir) {
        console.log(`   Working directory: ${workingDir}`);
      }
      
      // Get cached sandbox object
      const sandbox = this.sandboxCache.get(sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found in cache. Was it created?`);
      }
      
      // Build full command with working directory
      let fullCommand = command;
      if (workingDir) {
        fullCommand = `cd ${workingDir} && ${command}`;
      }
      
      const response = await sandbox.process.executeCommand(fullCommand);
      
      return {
        output: response.result || '',
        exitCode: response.exitCode || 0,
      };
    } catch (error: any) {
      throw new Error(
        `Failed to execute command: ${error.message}`
      );
    }
  }

  /**
   * Clone repository into sandbox using git command
   * Note: Using git command directly instead of SDK API due to format mismatch
   */
  async cloneRepository(
    sandboxId: string, 
    repoUrl: string, 
    branch: string = 'main',
    path: string = '/workspace'
  ): Promise<void> {
    try {
      console.log(`   Cloning ${repoUrl} (branch: ${branch}) to ${path}`);
      
      // Get cached sandbox object
      const sandbox = this.sandboxCache.get(sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found in cache`);
      }
      
      // Use git command directly (SDK API has format issues)
      const repoName = this.extractRepoName(repoUrl);
      const targetPath = `${path}/${repoName}`;
      
      await this.executeCommand(
        sandboxId,
        `git clone --branch ${branch} --depth 1 ${repoUrl} ${targetPath}`
      );
      console.log(`   ✓ Repository cloned to ${targetPath}`);
    } catch (error: any) {
      throw new Error(
        `Failed to clone repository: ${error.message}`
      );
    }
  }

  /**
   * Download file from sandbox using SDK
   */
  async downloadFile(sandboxId: string, filePath: string): Promise<string> {
    try {
      console.log(`   Downloading file: ${filePath}`);
      
      // Get cached sandbox object
      const sandbox = this.sandboxCache.get(sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found in cache`);
      }
      
      // Use SDK's file system operations
      try {
        const content = await sandbox.fs.readFile(filePath);
        console.log(`   ✓ File downloaded successfully`);
        return content;
      } catch (fsError: any) {
        // Fallback to cat command
        console.log(`   Using cat command fallback`);
        const result = await this.executeCommand(sandboxId, `cat ${filePath}`);
        return result.output;
      }
    } catch (error: any) {
      throw new Error(
        `Failed to download file: ${error.message}`
      );
    }
  }

  /**
   * Upload file to sandbox
   */
  async uploadFile(sandboxId: string, filePath: string, content: string): Promise<void> {
    try {
      // Get cached sandbox object
      const sandbox = this.sandboxCache.get(sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found in cache`);
      }
      
      // Use SDK's file system operations
      await sandbox.fs.writeFile(filePath, content);
    } catch (error: any) {
      throw new Error(
        `Failed to upload file: ${error.message}`
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
        `Failed to create directory: ${error.message}`
      );
    }
  }

  /**
   * Check if file exists in sandbox
   */
  async fileExists(sandboxId: string, filePath: string): Promise<boolean> {
    try {
      // Get cached sandbox object
      const sandbox = this.sandboxCache.get(sandboxId);
      if (!sandbox) {
        return false;
      }
      
      // Use SDK's file system to check existence
      try {
        await sandbox.fs.readFile(filePath);
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Poll sandbox until it's ready (SDK sandboxes are ready when returned)
   */
  async waitForSandboxReady(
    sandboxId: string,
    maxWaitTime: number = 300000,
    pollInterval: number = 5000
  ): Promise<any> {
    try {
      // With SDK, sandbox is ready when created
      // Just return the cached sandbox
      const sandbox = this.sandboxCache.get(sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found in cache`);
      }
      console.log(`✅ Sandbox is ready`);
      return sandbox;
    } catch (error: any) {
      throw new Error(
        `Sandbox ${sandboxId} is not ready: ${error.message}`
      );
    }
  }

  /**
   * Delete sandbox
   */
  async deleteSandbox(sandboxId: string): Promise<void> {
    try {
      // Get cached sandbox object
      const sandbox = this.sandboxCache.get(sandboxId);
      if (sandbox) {
        await sandbox.delete();
        // Remove from cache
        this.sandboxCache.delete(sandboxId);
      }
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

