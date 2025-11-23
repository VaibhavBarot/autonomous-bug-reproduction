import { DaytonaClient } from './daytona-client-sdk';
import { GitHubClient, PRContext } from './github-client';
import chalk from 'chalk';

export interface PRHandlerConfig {
  daytonaApiUrl: string;
  daytonaApiKey: string;
  githubToken: string;
  bugbotRepoUrl?: string; // URL to BugBot repository
  bugDescription?: string;
  maxSteps?: number;
  timeout?: number;
  apiKey?: string; // Gemini/OpenAI API key
  provider?: 'gemini' | 'openai';
  headless?: boolean;
}

export class PRHandler {
  private daytona: DaytonaClient;
  private github: GitHubClient;
  private config: PRHandlerConfig;

  constructor(config: PRHandlerConfig) {
    this.config = config;
    this.daytona = new DaytonaClient(config.daytonaApiUrl, config.daytonaApiKey);
    this.github = new GitHubClient(config.githubToken);
  }

  /**
   * Main handler for PR events
   */
  async handlePR(prContext: PRContext): Promise<void> {
    const { owner, repo, prNumber, branch, repoUrl } = prContext;
    let sandboxId: string | null = null;

    try {
      console.log(chalk.blue(`\n🔄 Processing PR #${prNumber} from ${owner}/${repo}`));
      
      // Step 1: Post initial comment
      await this.github.postPRComment(
        owner,
        repo,
        prNumber,
        '🤖 BugBot is creating a test environment and will test this PR...'
      );

      // Step 2: Create Daytona sandbox
      console.log(chalk.yellow('📦 Creating Daytona sandbox...'));
      const sandbox = await this.daytona.createSandbox('typescript');
      sandboxId = sandbox.id;
      console.log(chalk.green(`✓ Sandbox created: ${sandboxId}`));

      // Step 3: Wait for sandbox to be ready
      console.log(chalk.yellow('⏳ Waiting for sandbox to be ready...'));
      await this.daytona.waitForSandboxReady(sandboxId);
      console.log(chalk.green(`✓ Sandbox is ready`));

      // Step 4: Update PR comment
      await this.github.postPRComment(
        owner,
        repo,
        prNumber,
        `🔧 Environment ready\n\n📦 Setting up user application and BugBot...`
      );

      // Step 5: Clone user's PR branch
      console.log(chalk.yellow('📥 Cloning user repository...'));
      const userRepoName = this.daytona.extractRepoName(repoUrl);
      const userRepoBasePath = `/workspace/${userRepoName}`;
      
      await this.daytona.cloneRepository(sandboxId, repoUrl, branch, userRepoBasePath);
      // Clone creates nested directory: /workspace/repo-name/repo-name
      const userRepoPath = `${userRepoBasePath}/${userRepoName}`;
      console.log(chalk.green(`✓ User repository cloned to ${userRepoPath}`));

      // Step 6: Clone BugBot repository
      console.log(chalk.yellow('🤖 Cloning BugBot repository...'));
      const bugbotRepoUrl = this.config.bugbotRepoUrl || 
        'https://github.com/your-org/autonomous-bug-reproduction.git';
      const bugbotRepoName = this.daytona.extractRepoName(bugbotRepoUrl);
      const bugbotBasePath = '/workspace/bugbot';
      
      await this.daytona.cloneRepository(sandboxId, bugbotRepoUrl, 'main', bugbotBasePath);
      // Clone creates nested directory: /workspace/bugbot/repo-name
      const bugbotPath = `${bugbotBasePath}/${bugbotRepoName}`;
      console.log(chalk.green(`✓ BugBot cloned to ${bugbotPath}`));

      // Step 7: Setup user application
      console.log(chalk.yellow('📦 Setting up user application...'));
      await this.setupUserApp(sandboxId, userRepoPath);
      console.log(chalk.green('✓ User application setup complete'));

      // Step 8: Setup BugBot
      console.log(chalk.yellow('🤖 Setting up BugBot...'));
      await this.setupBugBot(sandboxId, bugbotPath);
      console.log(chalk.green('✓ BugBot setup complete'));

      // Step 9: Update PR comment
      await this.github.postPRComment(
        owner,
        repo,
        prNumber,
        `✅ Setup complete\n\n🧪 Running BugBot tests...`
      );

      // Step 10: Run BugBot tests
      console.log(chalk.yellow('🧪 Running BugBot tests...'));
      const testResult = await this.runBugBotTests(sandboxId, bugbotPath);
      console.log(chalk.green('✓ Tests completed'));

      // Step 11: Retrieve test report
      console.log(chalk.yellow('📄 Retrieving test report...'));
      
      // Debug: Check if runs directory exists
      const checkRunsDir = await this.daytona.executeCommand(
        sandboxId,
        `ls -la ${bugbotPath}/runs 2>&1 || echo "runs directory does not exist"`
      );
      console.log(chalk.gray(`   Runs directory check: ${checkRunsDir.output.trim().substring(0, 100)}`));
      
      // Debug: Check current working directory
      const pwdResult = await this.daytona.executeCommand(sandboxId, 'pwd');
      console.log(chalk.gray(`   Working directory was: ${pwdResult.output.trim()}`));
      
      const reportPath = await this.findReportFile(sandboxId, bugbotPath);
      let reportContent = '';
      
      if (reportPath) {
        try {
          reportContent = await this.daytona.downloadFile(sandboxId, reportPath);
          console.log(chalk.green(`✓ Report retrieved from ${reportPath}`));
        } catch (error: any) {
          console.log(chalk.yellow(`⚠️  Failed to download report: ${error.message}`));
          // Try to get test output log as fallback
          try {
            const testOutput = await this.daytona.downloadFile(sandboxId, '/tmp/bugbot-test-output.log');
            reportContent = this.generateFallbackReport(testOutput);
          } catch {
            reportContent = this.generateFallbackReport(testResult);
          }
        }
      } else {
        console.log(chalk.yellow('⚠️  No report file found, checking test output log...'));
        // Try to get test output log to see what happened
        try {
          const testOutput = await this.daytona.downloadFile(sandboxId, '/tmp/bugbot-test-output.log');
          console.log(chalk.gray(`   Test output length: ${testOutput.length} characters`));
          console.log(chalk.gray(`   Test output preview: ${testOutput.substring(0, 200)}...`));
          reportContent = this.generateFallbackReport(testOutput);
          console.log(chalk.green('✓ Using test output log'));
        } catch (error: any) {
          console.log(chalk.yellow(`⚠️  Could not read test output log: ${error.message}`));
          reportContent = this.generateFallbackReport(testResult);
        }
      }

      // Step 12: Post results to PR
      await this.github.uploadReportToPR(
        owner,
        repo,
        prNumber,
        reportContent,
        `bugbot-report-pr-${prNumber}.md`
      );

      const successComment = `✅ BugBot Test Completed\n\n` +
        `Status: Tests completed\n\n` +
        `Report: See attached report above\n\n` +
        `---\n` +
        `✅ BugBot has completed testing the PR. Check the report above for detailed results.\n\n` +
        `_Report generated by BugBot_`;

      await this.github.postPRComment(owner, repo, prNumber, successComment);

      console.log(chalk.green(`\n✅ PR #${prNumber} processed successfully`));

    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error processing PR #${prNumber}:`), error);
      
      // Post error to PR
      await this.github.postPRComment(
        owner,
        repo,
        prNumber,
        `❌ BugBot encountered an error while testing this PR:\n\n\`\`\`\n${error.message}\n\`\`\`\n\nPlease check the logs for more details.`
      ).catch(err => console.error('Failed to post error comment:', err));

    } finally {
      // Step 13: Cleanup
      if (sandboxId) {
        console.log(chalk.yellow('🧹 Cleaning up sandbox...'));
        await this.daytona.deleteSandbox(sandboxId);
        console.log(chalk.green('✓ Sandbox deleted'));
      }
    }
  }

  /**
   * Setup user's application in the sandbox
   */
  private async setupUserApp(sandboxId: string, userRepoPath: string): Promise<void> {
    try {
      // Check if package.json exists at root
      const hasPackageJson = await this.daytona.fileExists(sandboxId, `${userRepoPath}/package.json`);
      
      // Also check for test-app directory (common in BugBot repo)
      const hasTestApp = await this.daytona.fileExists(sandboxId, `${userRepoPath}/test-app`);
      
      if (hasPackageJson) {
        console.log(chalk.gray('   Installing dependencies...'));
        await this.daytona.executeCommand(
          sandboxId,
          `cd ${userRepoPath} && npm install`
        );
        
        // Check if there's a start script
        const checkStart = await this.daytona.executeCommand(
          sandboxId,
          `cd ${userRepoPath} && npm run 2>&1 | grep -q "start" && echo "has-start" || echo "no-start"`
        );
        
        if (checkStart.output.includes('has-start')) {
          // Start the application in background
          console.log(chalk.gray('   Starting application...'));
          await this.daytona.executeCommand(
            sandboxId,
            `cd ${userRepoPath} && nohup npm start > /tmp/user-app.log 2>&1 & echo $! > /tmp/user-app.pid`
          );
          
          // Wait a bit for app to start
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else if (hasTestApp) {
          // Try to start test-app if it exists
          console.log(chalk.gray('   Found test-app, starting it...'));
          await this.daytona.executeCommand(
            sandboxId,
            `cd ${userRepoPath}/test-app && ./start.sh > /tmp/user-app.log 2>&1 & echo $! > /tmp/user-app.pid || cd ${userRepoPath}/test-app/backend && npm start > /tmp/user-app.log 2>&1 &`
          );
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          console.log(chalk.gray('   No start script found, skipping app startup'));
        }
        
        console.log(chalk.gray('   ✓ Application started (check /tmp/user-app.log for logs)'));
      } else {
        console.log(chalk.yellow('   ⚠️  No package.json found, skipping npm install'));
      }
    } catch (error: any) {
      console.log(chalk.yellow(`   ⚠️  User app setup had issues: ${error.message}`));
      console.log(chalk.gray('   Continuing anyway...'));
    }
  }

  /**
   * Setup BugBot in the sandbox
   */
  private async setupBugBot(sandboxId: string, bugbotPath: string): Promise<void> {
    try {
      // Install BugBot dependencies
      console.log(chalk.gray('   Installing BugBot dependencies...'));
      await this.daytona.executeCommand(sandboxId, 'npm install', bugbotPath);
      
      // Build BugBot if needed
      const hasBuildScript = await this.daytona.executeCommand(
        sandboxId,
        'npm run | grep build',
        bugbotPath
      );
      
      if (hasBuildScript.output.includes('build')) {
        console.log(chalk.gray('   Building BugBot...'));
        await this.daytona.executeCommand(sandboxId, 'npm run build', bugbotPath);
      }
      
      // Start BugBot runner service in background
      console.log(chalk.gray('   Starting BugBot runner service...'));
      await this.daytona.executeCommand(
        sandboxId,
        'cd packages/runner && nohup npm start > /tmp/bugbot-runner.log 2>&1 & echo $! > /tmp/bugbot-runner.pid',
        bugbotPath
      );
      
      // Wait for runner to be ready
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log(chalk.gray('   ✓ BugBot runner started (check /tmp/bugbot-runner.log for logs)'));
    } catch (error: any) {
      throw new Error(`Failed to setup BugBot: ${error.message}`);
    }
  }

  /**
   * Run BugBot tests
   */
  private async runBugBotTests(sandboxId: string, bugbotPath: string): Promise<string> {
    try {
      const bugDescription = this.config.bugDescription || 
        'Test the application in this PR to ensure it works correctly';
      const maxSteps = this.config.maxSteps || 20;
      const timeout = this.config.timeout || 300;
      
      // Set environment variables if provided
      let envVars = '';
      if (this.config.apiKey) {
        const envVarName = this.config.provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
        envVars = `export ${envVarName}="${this.config.apiKey}" && `;
      }
      if (this.config.provider) {
        envVars += `export LLM_PROVIDER="${this.config.provider}" && `;
      }
      
      // Run BugBot CLI (reports are saved to runs/<runId>/ in the working directory)
      console.log(chalk.gray('   Executing tests...'));
      // Ensure we're in the correct directory and set environment variables
      // Use a single command with proper directory change
      const command = `cd ${bugbotPath} && ${envVars}npm run bugbot:dev -- "${bugDescription}" ` +
        `--url "http://localhost:3000" ` +
        `--runner-url "http://localhost:3001" ` +
        `--max-steps ${maxSteps} ` +
        `--timeout ${timeout} ` +
        `--headless ${this.config.headless !== false} ` +
        `> /tmp/bugbot-test-output.log 2>&1; echo "Exit code: $?"`;
      
      const result = await this.daytona.executeCommand(sandboxId, command);
      
      // Also check the exit code from the log
      const exitCodeCheck = await this.daytona.executeCommand(
        sandboxId,
        `tail -1 /tmp/bugbot-test-output.log 2>/dev/null || echo "Log file not found"`
      );
      console.log(chalk.gray(`   Command exit status: ${exitCodeCheck.output.trim()}`));
      
      return result.output;
    } catch (error: any) {
      console.log(chalk.yellow(`   ⚠️  Test execution had issues: ${error.message}`));
      return error.message;
    }
  }

  /**
   * Find the generated report file
   */
  private async findReportFile(sandboxId: string, bugbotPath: string): Promise<string | null> {
    try {
      // BugBot saves reports to runs/<runId>/report.md in the working directory
      // Find the most recent run directory
      const findResult = await this.daytona.executeCommand(
        sandboxId,
        `find ${bugbotPath}/runs -name "report.md" -type f 2>/dev/null | sort -r | head -1`
      );
      
      const reportPath = findResult.output.trim();
      if (reportPath && await this.daytona.fileExists(sandboxId, reportPath)) {
        return reportPath;
      }
      
      // Fallback: check common locations
      const commonPaths = [
        `${bugbotPath}/runs/*/report.md`, // Try to find any report.md in runs subdirectories
        '/tmp/bugbot-test-output.log', // Use test output as fallback
      ];
      
      // Try to find any report.md in runs subdirectories
      for (const pathPattern of commonPaths) {
        if (pathPattern.includes('*')) {
          // Use find command for patterns
          const patternFind = await this.daytona.executeCommand(
            sandboxId,
            `find ${bugbotPath}/runs -name "report.md" -type f 2>/dev/null | head -1`
          );
          const foundPath = patternFind.output.trim();
          if (foundPath && await this.daytona.fileExists(sandboxId, foundPath)) {
            return foundPath;
          }
        } else if (await this.daytona.fileExists(sandboxId, pathPattern)) {
          return pathPattern;
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate fallback report if file not found
   */
  private generateFallbackReport(testOutput: string): string {
    return `# BugBot Test Report

## Test Execution

Tests were executed in the Daytona sandbox environment.

## Test Output

\`\`\`
${testOutput.slice(0, 5000)}${testOutput.length > 5000 ? '\n... (truncated)' : ''}
\`\`\`

## Notes

The detailed report file was not found. This may indicate:
- Tests completed but report generation failed
- Tests encountered an error before completion
- Report was saved to an unexpected location

Check the test output above for details about what was tested.

---
_Report generated by BugBot_
`;
  }
}
