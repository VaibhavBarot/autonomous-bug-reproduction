import * as fs from 'fs-extra';
import * as path from 'path';

export interface ArtifactPaths {
  runDir: string;
  tracingPath: string;
  videoPath: string | null;
  reportPath: string;
  harPath: string;
  logsPath: string;
}

export class ArtifactManager {
  private runDir: string;

  constructor(runId: string) {
    // Runs are stored in packages/runner/runs/ to be consistent with runner package
    this.runDir = path.join(process.cwd(), 'packages', 'runner', 'runs', runId);
  }

  async initialize(): Promise<ArtifactPaths> {
    await fs.ensureDir(this.runDir);
    await fs.ensureDir(path.join(this.runDir, 'videos'));

    return {
      runDir: this.runDir,
      tracingPath: path.join(this.runDir, 'trace.zip'),
      videoPath: null, // Will be set later
      reportPath: path.join(this.runDir, 'report.html'),
      harPath: path.join(this.runDir, 'network.har'),
      logsPath: path.join(this.runDir, 'console.log')
    };
  }

  async saveNetworkHAR(networkEntries: any[]): Promise<void> {
    const har = {
      log: {
        version: '1.2',
        creator: { name: 'BugBot', version: '1.0.0' },
        entries: networkEntries.map(entry => ({
          startedDateTime: new Date(entry.timestamp).toISOString(),
          request: {
            method: entry.method,
            url: entry.url,
            headers: Object.entries(entry.requestHeaders || {}).map(([name, value]) => ({
              name,
              value: String(value)
            })),
            httpVersion: 'HTTP/1.1'
          },
          response: {
            status: entry.status || 0,
            statusText: entry.status ? (entry.status < 400 ? 'OK' : 'Error') : 'Pending',
            headers: Object.entries(entry.responseHeaders || {}).map(([name, value]) => ({
              name,
              value: String(value)
            })),
            httpVersion: 'HTTP/1.1'
          },
          timings: {
            wait: 0,
            receive: 0,
            send: 0
          }
        }))
      }
    };

    await fs.writeJSON(path.join(this.runDir, 'network.har'), har, { spaces: 2 });
  }

  async saveConsoleLogs(logs: string[]): Promise<void> {
    await fs.writeFile(
      path.join(this.runDir, 'console.log'),
      logs.join('\n')
    );
  }

  async copyVideo(sourcePath: string | null): Promise<string | null> {
    if (!sourcePath || !await fs.pathExists(sourcePath)) {
      return null;
    }

    const filename = path.basename(sourcePath);
    const destPath = path.join(this.runDir, 'videos', filename);
    await fs.copy(sourcePath, destPath);
    return destPath;
  }

  getRunDir(): string {
    return this.runDir;
  }
}

