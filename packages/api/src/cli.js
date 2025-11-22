#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const child_process_1 = require("child_process");
const axios_1 = __importDefault(require("axios"));
const orchestrator_1 = require("./orchestrator");
const path = __importStar(require("path"));
const program = new commander_1.Command();
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
    .option('--openai-key <key>', 'OpenAI API key (or set OPENAI_API_KEY env var)')
    .action(async (bugDescription, options) => {
    console.log(chalk_1.default.blue.bold('\n🤖 BugBot - Autonomous Bug Reproduction System\n'));
    // Check if runner server is running
    const runnerUrl = options.runnerUrl || 'http://localhost:3001';
    try {
        await axios_1.default.get(`${runnerUrl}/dom`).catch(() => {
            throw new Error('Runner server not responding');
        });
    }
    catch (error) {
        console.log(chalk_1.default.yellow('Starting runner server...'));
        // Start runner server in background
        // Use workspace-relative path
        const runnerPath = path.join(__dirname, '../../runner/src/server.ts');
        const runnerProcess = (0, child_process_1.spawn)('npx', ['tsx', runnerPath], {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, PORT: '3001' },
            cwd: path.join(__dirname, '../../..')
        });
        runnerProcess.unref();
        // Wait for server to start
        let retries = 10;
        while (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
                await axios_1.default.get(`${runnerUrl}/dom`);
                break;
            }
            catch (e) {
                retries--;
                if (retries === 0) {
                    throw new Error('Runner server failed to start');
                }
            }
        }
    }
    const runId = `run-${Date.now()}`;
    console.log(chalk_1.default.gray(`Run ID: ${runId}\n`));
    const orchestrator = new orchestrator_1.Orchestrator({
        runnerUrl,
        targetUrl: options.url,
        bugDescription,
        maxSteps: parseInt(options.maxSteps),
        timeout: parseInt(options.timeout) * 1000,
        openaiApiKey: options.openaiKey || process.env.OPENAI_API_KEY,
        headless: options.headless
    }, runId);
    try {
        console.log(chalk_1.default.cyan('Initializing browser...'));
        await orchestrator.initialize();
        console.log(chalk_1.default.cyan(`Navigating to ${options.url}...`));
        console.log(chalk_1.default.cyan(`Bug: ${bugDescription}\n`));
        console.log(chalk_1.default.yellow('Starting autonomous exploration...\n'));
        const report = await orchestrator.execute();
        console.log(chalk_1.default.green.bold('\n✅ Execution Complete!\n'));
        console.log(chalk_1.default.white(`Status: ${chalk_1.default.bold(report.status.toUpperCase())}`));
        console.log(chalk_1.default.white(`Steps: ${report.steps.length}`));
        console.log(chalk_1.default.white(`Duration: ${Math.round((report.endTime.getTime() - report.startTime.getTime()) / 1000)}s\n`));
        const reportPath = path.join(process.cwd(), 'runs', runId, 'report.html');
        console.log(chalk_1.default.blue(`📊 Report: ${reportPath}\n`));
        if (report.status === 'reproduced') {
            console.log(chalk_1.default.green('🎉 Bug was successfully reproduced!'));
        }
        else if (report.status === 'timeout') {
            console.log(chalk_1.default.yellow('⏱️  Test timed out before completion.'));
        }
        else {
            console.log(chalk_1.default.red('❌ Bug reproduction failed.'));
        }
    }
    catch (error) {
        console.error(chalk_1.default.red(`\n❌ Error: ${error.message}\n`));
        process.exit(1);
    }
});
program.parse();
