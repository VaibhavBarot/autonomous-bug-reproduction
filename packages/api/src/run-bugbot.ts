// This module exposes a function to run BugBot orchestration directly from code
import { Orchestrator, OrchestratorConfig } from './orchestrator';
import { ReportData } from './report-generator';
import chalk from 'chalk';
import path from 'path';

export async function runBugBot(config: OrchestratorConfig): Promise<ReportData> {
  const runId = Date.now().toString();
  const orchestrator = new Orchestrator(config, runId);
  try {
    console.log(chalk.cyan('Initializing browser...'));
    await orchestrator.initialize();
    console.log(chalk.cyan(`Navigating to ${config.targetUrl}...`));
    console.log(chalk.cyan(`Bug: ${config.bugDescription}\n`));
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
    return report;
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    throw error;
  }
}
