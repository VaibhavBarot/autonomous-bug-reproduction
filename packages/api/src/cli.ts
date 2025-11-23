#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import axios from 'axios';
import { Orchestrator } from './orchestrator';
import { startDaytonaSandbox, DaytonaSandboxHandle } from './daytona-sandbox';
import * as path from 'path';
import * as fs from 'fs-extra';

const program = new Command();

program
  .name('bugbot')
  .description('Autonomous bug reproduction system')
  .version('1.0.0')
  .argument('<bug-description>', 'Description of the bug to reproduce')
  .option('-u, --url <url>', 'Target URL to test', 'http://localhost:3000')
  .option('-r, --runner-url <url>', 'Runner server URL', 'http://localhost:3001')
  .option('-s, --max-steps <number>', 'Maximum steps to take', '20')
  .option('-t, --timeout <seconds>', 'Timeout in seconds', '300')
  .option('--headless', 'Run browser in headless mode', false)
  .option('--api-key <key>', 'API key (or set GEMINI_API_KEY or OPENAI_API_KEY env var)')
  .option('--provider <provider>', 'LLM provider: gemini or openai', 'gemini')
  .option('--use-stagehand', 'Enable Stagehand for smarter browser actions (default: true when API key provided)', true)
  .option('--no-use-stagehand', 'Disable Stagehand and use legacy tools only')
  .option('--verbose', 'Show detailed LLM and interaction logs', false)
  .option('--daytona', 'Run the target app inside a Daytona sandbox environment', false)
  .option('--daytona-repo <url>', 'Git repository URL for the app to run in Daytona')
  .option('--daytona-branch <branch>', 'Git branch to check out in the Daytona sandbox', 'main')
  .option(
    '--daytona-project-path <path>',
    'Optional path inside the repo where the web app lives (e.g. test-app/frontend)'
  )
  .option(
    '--daytona-port <port>',
    'Port the app listens on inside the Daytona sandbox (used for preview URL)',
    '3000'
  )
  .option(
    '--daytona-install-command <cmd>',
    'Install command to run in Daytona (default: npm install)'
  )
  .option(
    '--daytona-start-command <cmd>',
    'Start command to run in Daytona (default: npm start)'
  )
  .action(async (bugDescription, options) => {
    console.log(chalk.blue.bold('\n🤖 BugBot - Autonomous Bug Reproduction System\n'));

    // Check if runner server is running
    const runnerUrl = options.runnerUrl || 'http://localhost:3001';
    const port = parseInt(new URL(runnerUrl).port) || 3001;
    let serverNeedsStart = false;
    let targetUrl: string = options.url || 'http://localhost:3000';
    let daytonaHandle: DaytonaSandboxHandle | null = null;
    
    try {
      await axios.get(`${runnerUrl}/health`, { timeout: 2000 });
      console.log(chalk.green('✓ Runner server already running'));
    } catch (error: any) {
      // Check if port is in use
      const net = require('net');
      const portInUse = await new Promise<boolean>((resolve) => {
        const tester = net.createServer()
          .once('error', (err: any) => {
            resolve(err.code === 'EADDRINUSE');
          })
          .once('listening', () => {
            tester.once('close', () => resolve(false)).close();
          })
          .listen(port);
      });

      if (portInUse) {
        console.log(chalk.yellow(`Port ${port} is in use. Attempting to use existing server...`));
        // Try multiple times with exponential backoff to connect
        let connected = false;
        for (let i = 0; i < 3; i++) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                await axios.get(`${runnerUrl}/health`, { timeout: 5000 });
                console.log(chalk.green('✓ Connected to existing server'));
                connected = true;
                serverNeedsStart = false;
                break;
            } catch (e) {
                // continue
            }
        }

        if (!connected) {
          // Try to find and kill the process
          const { execSync } = require('child_process');
          try {
            const pid = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' }).trim();
            if (pid) {
              console.log(chalk.yellow(`Found unresponsive process ${pid} using port ${port}. Killing it...`));
              execSync(`kill -9 ${pid}`);
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for port to free
              serverNeedsStart = true;
            }
          } catch (killError: any) {
            console.log(chalk.red(`Port ${port} is in use but server is not responding.`));
            console.log(chalk.yellow(`Please kill the process manually or use a different port:`));
            console.log(chalk.gray(`  lsof -ti:${port} | xargs kill -9`));
            console.log(chalk.gray(`  Or use: --runner-url http://localhost:3002`));
            // Try to start anyway, maybe it freed up
            serverNeedsStart = true; 
          }
        }
      } else {
        serverNeedsStart = true;
      }
    }
    
    if (serverNeedsStart) {
      console.log(chalk.yellow('Starting runner server...'));
      
      // Determine if we're running from compiled code or source
      const isCompiled = __dirname.includes('dist');
      let runnerPath: string;
      let command: string;
      let args: string[];
      
      if (isCompiled) {
        // Running from dist - use compiled server
        runnerPath = path.resolve(__dirname, '../../runner/dist/server.js');
        command = 'node';
        args = [runnerPath];
      } else {
        // Running from source - use tsx
        runnerPath = path.resolve(__dirname, '../../runner/src/server.ts');
        command = 'npx';
        args = ['tsx', runnerPath];
      }
      
      const projectRoot = path.resolve(__dirname, '../../..');
      
      // Verify the server file exists
      const fs = require('fs');
      if (!fs.existsSync(runnerPath)) {
        throw new Error(`Runner server file not found at: ${runnerPath}`);
      }
      
      console.log(chalk.gray(`Starting server: ${command} ${args.join(' ')}`));
      console.log(chalk.gray(`Working directory: ${projectRoot}`));
      
      // Start runner server in background with error logging
      const runnerProcess = spawn(command, args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: port.toString() },
        cwd: projectRoot
      });
      
      // Log server output for debugging
      let serverOutput = '';
      runnerProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        serverOutput += output + '\n';
        if (output) console.log(chalk.gray(`[Runner] ${output}`));
      });
      
      runnerProcess.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        serverOutput += output + '\n';
        if (output && !output.includes('ExperimentalWarning')) {
          console.error(chalk.red(`[Runner Error] ${output}`));
        }
      });
      
      runnerProcess.on('error', (err) => {
        console.error(chalk.red(`Failed to start runner server: ${err.message}`));
        console.error(chalk.red(`Command: ${command} ${args.join(' ')}`));
        console.error(chalk.red(`Path: ${runnerPath}`));
        throw err;
      });
      
      runnerProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          console.error(chalk.red(`Runner server exited with code ${code}`));
          console.error(chalk.red(`Output: ${serverOutput}`));
        }
      });
      
      // Wait for server to start with more retries
      let retries = 20; // Increased retries (10 seconds total)
      let serverStarted = false;
      
      while (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          await axios.get(`${runnerUrl}/health`, { timeout: 1000 });
          serverStarted = true;
          console.log(chalk.green('✓ Runner server started'));
          break;
        } catch (e: any) {
          retries--;
          if (retries === 0) {
            runnerProcess.kill('SIGTERM');
            throw new Error(`Runner server failed to start after 10 seconds. Make sure port 3001 is available. Server output: ${serverOutput}`);
          }
        }
      }
      
      // Keep process reference to prevent it from being killed
      runnerProcess.unref();
    }

    const runId = `run-${Date.now()}`;
    console.log(chalk.gray(`Run ID: ${runId}\n`));

    // Determine provider and API key
    const provider = (options.provider === 'openai' ? 'openai' : 'gemini') as 'openai' | 'gemini';
    const apiKey = options.apiKey || 
      (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY) ||
      process.env.GEMINI_API_KEY || 
      process.env.OPENAI_API_KEY;

    // Debug: log what we received (remove in production)
    if (process.env.DEBUG) {
      console.log(chalk.gray(`Debug - options.apiKey: ${options.apiKey ? 'provided' : 'not provided'}`));
      console.log(chalk.gray(`Debug - GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'set' : 'not set'}`));
      console.log(chalk.gray(`Debug - Provider: ${provider}`));
    }

    if (!apiKey) {
      console.error(chalk.red(`\n❌ API key required. Set GEMINI_API_KEY or OPENAI_API_KEY environment variable, or use --api-key flag.\n`));
      console.error(chalk.yellow(`Tip: When using npm run, use -- to separate arguments:\n`));
      console.error(chalk.gray(`  npm run bugbot -- "bug description" --api-key YOUR_KEY\n`));
      process.exit(1);
    }

    // If requested, spin up a Daytona sandbox and point BugBot at its preview URL
    if (options.daytona) {
      if (!options.daytonaRepo) {
        console.error(
          chalk.red(
            '\n❌ Daytona sandbox mode requires --daytona-repo <git-url> so the app can be cloned into the sandbox.\n'
          )
        );
        process.exit(1);
      }

      const daytonaPort = parseInt(options.daytonaPort || '3000', 10);

      console.log(chalk.cyan('\n🌊 Starting Daytona sandbox for target app...\n'));
      daytonaHandle = await startDaytonaSandbox({
        repoUrl: options.daytonaRepo,
        branch: options.daytonaBranch,
        projectPath: options.daytonaProjectPath,
        port: daytonaPort,
        installCommand: options.daytonaInstallCommand,
        startCommand: options.daytonaStartCommand,
      });

      targetUrl = daytonaHandle.appUrl;
      console.log(chalk.green(`Using Daytona sandbox app URL as target: ${targetUrl}\n`));
    }

    const orchestrator = new Orchestrator(
      {
        runnerUrl,
        targetUrl,
        bugDescription,
        maxSteps: parseInt(options.maxSteps),
        timeout: parseInt(options.timeout) * 1000,
        apiKey,
        provider,
        headless: options.headless,
        verbose: options.verbose || false,
        useStagehand: options.useStagehand !== false, // Enable by default if API key provided
      },
      runId
    );

    // Global error handler for the CLI process to catch unhandled promise rejections (like Axios errors)
    process.on('unhandledRejection', (reason: any, promise) => {
        if (reason.code === 'ECONNRESET') {
            // Ignore ECONNRESET during shutdown or flaky connection, as we might have already finished or will retry
            if (options.verbose) console.error(chalk.yellow('Warning: Connection reset (ECONNRESET).'));
        } else {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        }
    });

    try {
      console.log(chalk.cyan('Initializing browser...'));
      await orchestrator.initialize();

      console.log(chalk.cyan(`Navigating to ${targetUrl}...`));
      console.log(chalk.cyan(`Bug: ${bugDescription}\n`));
      console.log(chalk.yellow('Starting autonomous exploration...\n'));

      const report = await orchestrator.execute();

      console.log(chalk.green.bold('\n✅ Execution Complete!\n'));
      console.log(chalk.white(`Status: ${chalk.bold(report.status.toUpperCase())}`));
      console.log(chalk.white(`Steps: ${report.steps.length}`));
      console.log(chalk.white(`Duration: ${Math.round((report.endTime.getTime() - report.startTime.getTime()) / 1000)}s\n`));
      
      const reportPath = path.join(process.cwd(), 'runs', runId, 'report.html');
      console.log(chalk.blue(`📊 Report: ${reportPath}\n`));

      if (report.status === 'reproduced') {
        console.log(chalk.green('🎉 Bug was successfully reproduced!'));
      } else if (report.status === 'timeout') {
        console.log(chalk.yellow('⏱️  Test timed out before completion.'));
      } else {
        console.log(chalk.red('❌ Bug reproduction failed.'));
      }
    } catch (error: any) {
      if (error.code === 'ECONNRESET') {
          console.error(chalk.red(`\n❌ Connection to runner server lost. Please try again.\n`));
      } else {
          console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      }
      if (daytonaHandle) {
        await daytonaHandle.stop().catch(() => {
          // ignore
        });
      }
      process.exit(1);
    } finally {
      if (daytonaHandle) {
        await daytonaHandle.stop().catch(() => {
          // ignore
        });
      }
    }
  });

program.parse();
