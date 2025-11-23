import { PRHandler } from './src/pr-handler';
import * as dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

async function testPRHandler() {
  console.log(chalk.blue.bold('\n🧪 Testing PR Handler\n'));

  // Check required env vars
  const required = [
    'DAYTONA_API_URL',
    'DAYTONA_API_KEY',
    'GITHUB_TOKEN',
    'GEMINI_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(chalk.red(`❌ Missing environment variables: ${missing.join(', ')}`));
    console.log(chalk.yellow('   Set these in .env file'));
    process.exit(1);
  }

  const handler = new PRHandler({
    daytonaApiUrl: process.env.DAYTONA_API_URL!,
    daytonaApiKey: process.env.DAYTONA_API_KEY!,
    githubToken: process.env.GITHUB_TOKEN!,
    bugDescription: 'Test the application to ensure it works correctly',
    maxSteps: 5, // Reduced for testing
    timeout: 120, // 2 minutes for testing
    apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
    provider: (process.env.LLM_PROVIDER as 'gemini' | 'openai') || 'gemini',
    headless: true,
  });

  // Get test PR details from env or use defaults
  const testPR = {
    owner: process.env.TEST_REPO_OWNER || 'VaibhavBarot',
    repo: process.env.TEST_REPO_NAME || 'autonomous-bug-reproduction',
    prNumber: parseInt(process.env.TEST_PR_NUMBER || '1'),
    branch: process.env.TEST_BRANCH || 'test-webhook',
    repoUrl: process.env.TEST_REPO_URL || 'https://github.com/VaibhavBarot/autonomous-bug-reproduction.git',
  };

  console.log(chalk.yellow(`Testing with PR:`));
  console.log(chalk.gray(`  Owner: ${testPR.owner}`));
  console.log(chalk.gray(`  Repo: ${testPR.repo}`));
  console.log(chalk.gray(`  PR #: ${testPR.prNumber}`));
  console.log(chalk.gray(`  Branch: ${testPR.branch}`));
  console.log('');

  try {
    await handler.handlePR(testPR);
    console.log(chalk.green.bold('\n✅ PR Handler test completed!\n'));
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

testPRHandler();


