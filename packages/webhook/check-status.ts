import { DaytonaClient } from './src/daytona-client';
import * as dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

async function checkStatus() {
  const apiUrl = process.env.DAYTONA_API_URL;
  const apiKey = process.env.DAYTONA_API_KEY;
  const workspaceId = process.argv[2];

  if (!apiUrl || !apiKey) {
    console.error(chalk.red('❌ Missing DAYTONA_API_URL or DAYTONA_API_KEY'));
    console.log(chalk.yellow('   Set these in .env file'));
    process.exit(1);
  }

  if (!workspaceId) {
    console.error(chalk.red('❌ Missing workspace ID'));
    console.log(chalk.yellow('   Usage: tsx check-status.ts <workspace-id>'));
    console.log(chalk.gray('   Example: tsx check-status.ts 916650db-0ab7-48d5-b0bd-99b405307e61'));
    process.exit(1);
  }

  const client = new DaytonaClient(apiUrl, apiKey);

  console.log(chalk.blue.bold(`\n🔍 Checking Status for Workspace: ${workspaceId}\n`));

  try {
    // Get workspace status
    console.log(chalk.yellow('📊 Getting workspace status...'));
    const workspace = await client.getWorkspaceStatus(workspaceId);
    const currentState = workspace.state || workspace.status;
    const desiredState = workspace.desiredState || 'started';
    
    console.log(chalk.green('✓ Workspace Status:'));
    console.log(chalk.gray(`   State: ${currentState}`));
    console.log(chalk.gray(`   Desired State: ${desiredState}`));
    console.log(chalk.gray(`   ID: ${workspace.id}`));
    console.log(chalk.gray(`   Name: ${workspace.name}`));
    console.log('');

    // Check setup status
    console.log(chalk.yellow('🔍 Checking setup status...'));
    const setupStatus = await client.checkSetupStatus(workspaceId);
    console.log(chalk.green('✓ Setup Status:'));
    console.log(chalk.gray(`   Is Running: ${setupStatus.isRunning ? '✅ Yes' : '❌ No'}`));
    console.log(chalk.gray(`   Is Complete: ${setupStatus.isComplete ? '✅ Yes' : '⏳ No'}`));
    console.log(chalk.gray(`   Has Report: ${setupStatus.hasReport ? '✅ Yes' : '❌ No'}`));
    console.log('');

    // Try to get logs
    console.log(chalk.yellow('📋 Trying to get workspace logs...'));
    const logs = await client.getWorkspaceLogs(workspaceId);
    if (logs) {
      console.log(chalk.green('✓ Logs Retrieved:'));
      const recentLogs = logs.split('\n').slice(-20).join('\n');
      console.log(chalk.gray(recentLogs));
    } else {
      console.log(chalk.yellow('⚠️  Logs not available via API'));
      console.log(chalk.gray('   Try accessing workspace directly or check Daytona dashboard'));
    }
    console.log('');

    // Provide helpful links
    console.log(chalk.blue.bold('💡 How to Check Setup Progress:\n'));
    console.log(chalk.gray('1. Daytona Dashboard:'));
    console.log(chalk.white(`   ${apiUrl.replace('/api', '')}/workspace/${workspaceId}`));
    console.log('');
    console.log(chalk.gray('2. Check API endpoints:'));
    console.log(chalk.white(`   ${apiUrl}/sandbox/${workspaceId}/logs`));
    console.log(chalk.white(`   ${apiUrl}/sandbox/${workspaceId}/output`));
    console.log('');
    console.log(chalk.gray('3. If you have SSH access, check files:'));
    console.log(chalk.white('   ls -la /tmp/workspace-setup-complete'));
    console.log(chalk.white('   tail -f /tmp/user-app.log'));
    console.log(chalk.white('   tail -f /tmp/bugbot-runner.log'));
    console.log(chalk.white('   tail -f /tmp/bugbot-test-output.log'));
    console.log(chalk.white('   ls -la /tmp/bugbot-report.md'));

  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    if (error.response) {
      console.error(chalk.gray(`   Status: ${error.response.status}`));
      console.error(chalk.gray(`   Data: ${JSON.stringify(error.response.data, null, 2)}`));
    }
    process.exit(1);
  }
}

checkStatus();


