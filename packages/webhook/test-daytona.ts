import { DaytonaClient } from './src/daytona-client';
import * as dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

async function testDaytona() {
  console.log(chalk.blue.bold('\n🧪 Testing Daytona Connection\n'));

  const apiUrl = process.env.DAYTONA_API_URL;
  const apiKey = process.env.DAYTONA_API_KEY;

  if (!apiUrl || !apiKey) {
    console.error(chalk.red('❌ Missing DAYTONA_API_URL or DAYTONA_API_KEY'));
    console.log(chalk.yellow('   Set these in .env file'));
    process.exit(1);
  }

  const client = new DaytonaClient(apiUrl, apiKey);
  let sandboxId: string | null = null;

  try {
    // Test sandbox creation
    console.log(chalk.yellow('📦 Testing sandbox creation...'));
    const language = process.env.TEST_LANGUAGE || 'typescript';
    const sandbox = await client.createSandbox(language);
    sandboxId = sandbox.id;
    
    console.log(chalk.green(`✓ Sandbox created: ${sandboxId}`));
    
    // Wait for ready
    console.log(chalk.yellow('⏳ Waiting for sandbox to be ready...'));
    const ready = await client.waitForSandboxReady(sandboxId, 60000); // 1 minute timeout for testing
    console.log(chalk.green(`✓ Sandbox ready with state: ${ready.state || 'started'}`));
    
    // Test getting sandbox status
    console.log(chalk.yellow('🔍 Testing sandbox status retrieval...'));
    const status = await client.getSandboxStatus(sandboxId);
    console.log(chalk.green(`✓ Sandbox status retrieved:`));
    console.log(chalk.gray(`   ID: ${status.id}`));
    console.log(chalk.gray(`   State: ${status.state}`));
    
    // Test cloning repository (optional)
    const testRepo = process.env.TEST_REPO_URL;
    if (testRepo) {
      console.log(chalk.yellow('📥 Testing repository clone...'));
      const testBranch = process.env.TEST_BRANCH || 'main';
      await client.cloneRepository(sandboxId, testRepo, testBranch, '/workspace/test-repo');
      console.log(chalk.green(`✓ Repository cloned successfully`));
    } else {
      console.log(chalk.gray('   Skipping repository clone (TEST_REPO_URL not set)'));
    }
    
    // Cleanup
    console.log(chalk.yellow('🧹 Cleaning up test sandbox...'));
    await client.deleteSandbox(sandboxId);
    console.log(chalk.green('✓ Sandbox deleted'));
    
    console.log(chalk.green.bold('\n✅ All Daytona tests passed!\n'));
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    if (error.response) {
      console.error(chalk.gray(`   Status: ${error.response.status}`));
      console.error(chalk.gray(`   Data: ${JSON.stringify(error.response.data, null, 2)}`));
    }
    
    // Cleanup on error
    if (sandboxId) {
      try {
        console.log(chalk.yellow('🧹 Attempting to cleanup sandbox after error...'));
        await client.deleteSandbox(sandboxId);
      } catch (cleanupError: any) {
        console.error(chalk.red(`   Cleanup failed: ${cleanupError.message}`));
      }
    }
    
    process.exit(1);
  }
}

testDaytona();


