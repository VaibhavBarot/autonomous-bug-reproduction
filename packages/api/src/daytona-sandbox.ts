import { Daytona } from '@daytonaio/sdk';
import chalk from 'chalk';

export interface DaytonaSandboxOptions {
  /** Git repository URL that contains the app to run inside the sandbox */
  repoUrl: string;
  /** Branch to check out (default: main) */
  branch?: string;
  /**
   * Optional path inside the cloned repo where the web app lives,
   * e.g. "test-app/frontend"
   */
  projectPath?: string;
  /** Port the app will listen on inside the sandbox (used for preview link) */
  port: number;
  /** Command to install deps (default: npm install) */
  installCommand?: string;
  /** Command to start the app (default: npm start) */
  startCommand?: string;
  /** Extra environment variables for the sandbox */
  env?: Record<string, string>;
}

export interface DaytonaSandboxHandle {
  appUrl: string;
  /**
   * Best‑effort cleanup of the sandbox.
   * Safe to call multiple times.
   */
  stop: () => Promise<void>;
}

/**
 * Create a Daytona sandbox, clone the target repo, install dependencies,
 * start the app, and return a preview URL that BugBot can use as targetUrl.
 *
 * This relies only on process.executeCommand + getPreviewLink, so it works
 * across different project setups as long as you can start the app with a
 * shell command that binds to the provided port.
 */
export async function startDaytonaSandbox(
  options: DaytonaSandboxOptions
): Promise<DaytonaSandboxHandle> {
  const {
    repoUrl,
    branch = 'main',
    projectPath,
    port,
    installCommand = 'npm install',
    startCommand = 'npm start',
    env = {},
  } = options;

  if (!process.env.DAYTONA_API_KEY) {
    throw new Error(
      'DAYTONA_API_KEY is required to use Daytona sandbox mode. Set it in your environment.'
    );
  }

  const daytona = new Daytona(); // Uses DAYTONA_API_KEY / DAYTONA_API_URL / DAYTONA_TARGET env vars

  console.log(chalk.cyan('\n🌊 Creating Daytona sandbox...'));

  const sandbox = await daytona.create({
    public: true,
    language: 'typescript',
    envVars: {
      NODE_ENV: 'development',
      IN_DAYTONA: 'true',
      ...env,
    },
  } as any);

  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await daytona.stop(sandbox as any);
    } catch (e) {
      console.warn(chalk.yellow(`Daytona stop failed (ignored): ${(e as any)?.message || e}`));
    }
    try {
      await daytona.delete(sandbox as any);
    } catch (e) {
      console.warn(chalk.yellow(`Daytona delete failed (ignored): ${(e as any)?.message || e}`));
    }
  };

  try {
    // 1. Clone the repo into the sandbox (non‑interactive, shallow clone)
    //    GIT_TERMINAL_PROMPT=0 ensures we fail fast instead of hanging if auth is required.
    const appDir = 'app';
    const cloneCmd = `GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch ${branch} --single-branch ${repoUrl} ${appDir}`;
    console.log(chalk.gray(`Daytona: ${cloneCmd}`));
    await sandbox.process.executeCommand(cloneCmd);
    console.log(chalk.gray('Daytona: git clone completed'));

    // 2. Install dependencies
    const projectDir = projectPath ? `${appDir}/${projectPath}` : appDir;
    const installCmd = `cd ${projectDir} && ${installCommand}`;
    console.log(chalk.gray(`Daytona: ${installCmd}`));
    await sandbox.process.executeCommand(installCmd);

    // 3. Start the app using Daytona's long‑running process API when available
    //    so the backend/frontend stay alive for the duration of the sandbox.
    const startCmd = `cd ${projectDir} && ${startCommand}`;
    console.log(chalk.gray(`Daytona: ${startCmd}`));

    const processApi: any = (sandbox as any).process;
    if (processApi && typeof processApi.start === 'function') {
      // Hint Daytona which port will be exposed for preview
      await processApi.start({
        command: startCmd,
        ports: [port],
      });
    } else {
      // Fallback to fire‑and‑forget executeCommand
      processApi
        .executeCommand(startCmd)
        .catch((e: any) => {
          console.warn(
            chalk.yellow(
              `Daytona: start command reported an error (may be after preview is available): ${
                e?.message || e
              }`
            )
          );
        });
    }

    // Give the app some time to boot before requesting a preview link
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // 4. Get a preview URL for the specified port
    const previewInfo: any = await (sandbox as any).getPreviewLink(port);
    const appUrl: string = previewInfo?.url || previewInfo;

    console.log(chalk.green(`\n✅ Daytona sandbox app is running at: ${appUrl}\n`));

    return {
      appUrl,
      stop: cleanup,
    };
  } catch (error: any) {
    console.error(chalk.red('Daytona sandbox startup failed, cleaning up sandbox...'));
    await cleanup().catch(() => {
      // ignore
    });
    throw error;
  }
}


