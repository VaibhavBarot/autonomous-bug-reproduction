import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import chalk from 'chalk';

async function main() {
  const apiKey = process.env.DAYTONA_API_KEY;
  const apiUrl = process.env.DAYTONA_API_URL;
  const target = process.env.DAYTONA_TARGET;

  console.log(chalk.cyan('\n🔑 Daytona config from environment (.env):'));
  console.log(chalk.gray(`  DAYTONA_API_KEY set: ${apiKey ? 'yes' : 'no'}`));
  console.log(chalk.gray(`  DAYTONA_API_URL: ${apiUrl || '(default)'}`));
  console.log(chalk.gray(`  DAYTONA_TARGET: ${target || '(default)'}`));

  if (!apiKey) {
    throw new Error(
      'DAYTONA_API_KEY is not set. Please add it to your .env (lines 1–12) and retry.'
    );
  }

  // Initialize the SDK – this uses DAYTONA_API_KEY / DAYTONA_API_URL / DAYTONA_TARGET
  // as described in the Daytona TypeScript SDK docs:
  // https://www.daytona.io/docs/en/typescript-sdk/
  const daytona = new Daytona();

  console.log(chalk.cyan('\n🌊 Creating test Daytona sandbox...'));

  const sandbox = await daytona.create({
    language: 'typescript',
    envVars: { NODE_ENV: 'development' },
  } as any);

  try {
    console.log(chalk.cyan('▶️ Executing test command inside sandbox: echo "Hello, Daytona!"'));

    const response: any = await sandbox.process.executeCommand('echo "Hello, Daytona!"');

    console.log(chalk.green('\n✅ Command executed inside Daytona sandbox.'));
    console.log(chalk.gray('Result / stdout:'));
    console.log(response.result ?? response.stdout ?? '(no output)');
  } finally {
    console.log(chalk.cyan('\n🧹 Cleaning up test sandbox...'));
    try {
      await (daytona as any).stop(sandbox);
    } catch (e) {
      console.warn(chalk.yellow(`Daytona stop failed (ignored): ${(e as any)?.message || e}`));
    }
    try {
      await (daytona as any).delete(sandbox);
    } catch (e) {
      console.warn(chalk.yellow(`Daytona delete failed (ignored): ${(e as any)?.message || e}`));
    }
  }

  console.log(chalk.green('\nDone.\n'));
}

main().catch((err) => {
  console.error(chalk.red(`\n❌ Daytona test failed: ${err.message}\n`));
  process.exit(1);
});


