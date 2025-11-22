import * as fs from 'fs-extra';
import * as path from 'path';

export interface BugReport {
  bugDescription: string;
  status: 'reproduced' | 'failed' | 'timeout';
  duration: number;
  stepsTaken: number;
  startTime: string;
  endTime: string;
  steps: ParsedStep[];
  consoleErrors: string[];
  networkRequests: NetworkRequest[];
  artifactPaths: {
    video: string;
    trace: string;
    har: string;
    logs: string;
  };
}

export interface ParsedStep {
  stepNumber: number;
  action: {
    type: string;
    selector: string;
    text?: string;
  };
  thought?: string;
  url: string;
  title: string;
}

export interface NetworkRequest {
  method: string;
  url: string;
  status?: number;
  path: string; // Extracted path from URL
}

export class ReportParser {
  /**
   * Parse a bug report markdown file and extract structured data
   */
  static async parse(runId: string): Promise<BugReport> {
    const reportPath = path.join(process.cwd(), 'runs', runId, 'report.md');
    
    if (!await fs.pathExists(reportPath)) {
      throw new Error(`Report file not found: ${reportPath}`);
    }

    const content = await fs.readFile(reportPath, 'utf-8');
    
    return this.parseMarkdown(content);
  }

  /**
   * Parse markdown content into structured BugReport
   */
  private static parseMarkdown(content: string): BugReport {
    const lines = content.split('\n');
    
    // Initialize result
    const report: BugReport = {
      bugDescription: '',
      status: 'failed',
      duration: 0,
      stepsTaken: 0,
      startTime: '',
      endTime: '',
      steps: [],
      consoleErrors: [],
      networkRequests: [],
      artifactPaths: {
        video: '',
        trace: '',
        har: '',
        logs: ''
      }
    };

    let currentSection = '';
    let currentStep: Partial<ParsedStep> | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detect sections
      if (line === '## Summary') {
        currentSection = 'summary';
        continue;
      } else if (line === '## Execution Steps') {
        currentSection = 'steps';
        continue;
      } else if (line === '## Console Errors') {
        currentSection = 'errors';
        continue;
      } else if (line === '## Network Activity') {
        currentSection = 'network';
        continue;
      } else if (line === '## Artifacts') {
        currentSection = 'artifacts';
        continue;
      } else if (line === '## Conclusion') {
        currentSection = 'conclusion';
        continue;
      }

      // Parse summary section
      if (currentSection === 'summary') {
        if (line.startsWith('- **Bug Description**:')) {
          report.bugDescription = line.replace('- **Bug Description**:', '').trim();
        } else if (line.startsWith('- **Status**:')) {
          const status = line.replace('- **Status**:', '').trim().toLowerCase();
          if (status === 'reproduced' || status === 'failed' || status === 'timeout') {
            report.status = status;
          }
        } else if (line.startsWith('- **Duration**:')) {
          const duration = line.replace('- **Duration**:', '').replace('seconds', '').trim();
          report.duration = parseInt(duration) || 0;
        } else if (line.startsWith('- **Steps Taken**:')) {
          const steps = line.replace('- **Steps Taken**:', '').trim();
          report.stepsTaken = parseInt(steps) || 0;
        } else if (line.startsWith('- **Start Time**:')) {
          report.startTime = line.replace('- **Start Time**:', '').trim();
        } else if (line.startsWith('- **End Time**:')) {
          report.endTime = line.replace('- **End Time**:', '').trim();
        }
      }

      // Parse execution steps
      if (currentSection === 'steps') {
        if (line.startsWith('### Step')) {
          // Save previous step if exists
          if (currentStep && currentStep.stepNumber) {
            report.steps.push(currentStep as ParsedStep);
          }
          
          // Start new step
          const stepNum = parseInt(line.replace('### Step', '').trim());
          currentStep = {
            stepNumber: stepNum,
            action: { type: '', selector: '' },
            url: '',
            title: ''
          };
        } else if (currentStep) {
          if (line.startsWith('**Action**:')) {
            // Parse action: `type` on `selector` with text "text"
            const actionText = line.replace('**Action**:', '').trim();
            const typeMatch = actionText.match(/`(\w+)`/);
            const selectorMatch = actionText.match(/on `([^`]+)`/);
            const textMatch = actionText.match(/with text "([^"]+)"/);
            
            if (typeMatch) currentStep.action!.type = typeMatch[1];
            if (selectorMatch) currentStep.action!.selector = selectorMatch[1];
            if (textMatch) currentStep.action!.text = textMatch[1];
          } else if (line.startsWith('**Thought**:')) {
            currentStep.thought = line.replace('**Thought**:', '').trim();
          } else if (line.startsWith('- URL:')) {
            currentStep.url = line.replace('- URL:', '').trim();
          } else if (line.startsWith('- Title:')) {
            currentStep.title = line.replace('- Title:', '').trim();
          }
        }
      }

      // Parse console errors
      if (currentSection === 'errors') {
        if (line.startsWith('- ') && line !== '- None') {
          report.consoleErrors.push(line.substring(2));
        }
      }

      // Parse network activity
      if (currentSection === 'network') {
        if (line.startsWith('- ') && !line.startsWith('- GET') && !line.startsWith('- POST') && !line.startsWith('- PUT') && !line.startsWith('- DELETE') && !line.startsWith('- PATCH')) {
          // Skip "Total requests: N" line
          continue;
        }
        
        if (line.startsWith('- ')) {
          // Format: - METHOD url (status)
          const match = line.match(/- (\w+) ([^\s]+)(?: \((\d+|pending)\))?/);
          if (match) {
            const method = match[1];
            const url = match[2];
            const statusStr = match[3];
            const status = statusStr && statusStr !== 'pending' ? parseInt(statusStr) : undefined;
            
            // Extract path from URL
            let urlPath = url;
            try {
              const urlObj = new URL(url);
              urlPath = urlObj.pathname;
            } catch {
              // If not a valid URL, treat as path
              urlPath = url;
            }
            
            report.networkRequests.push({
              method,
              url,
              status,
              path: urlPath
            });
          }
        }
      }

      // Parse artifacts
      if (currentSection === 'artifacts') {
        if (line.startsWith('- Video:')) {
          report.artifactPaths.video = line.replace('- Video:', '').trim();
        } else if (line.startsWith('- Trace:')) {
          report.artifactPaths.trace = line.replace('- Trace:', '').trim();
        } else if (line.startsWith('- HAR:')) {
          report.artifactPaths.har = line.replace('- HAR:', '').trim();
        } else if (line.startsWith('- Logs:')) {
          report.artifactPaths.logs = line.replace('- Logs:', '').trim();
        }
      }
    }

    // Save last step if exists
    if (currentStep && currentStep.stepNumber) {
      report.steps.push(currentStep as ParsedStep);
    }

    return report;
  }

  /**
   * Extract file paths mentioned in console errors
   */
  static extractFilePaths(consoleErrors: string[]): string[] {
    const filePaths: string[] = [];
    
    // Look for patterns like "at Object.<anonymous> (/path/to/file.js:123:45)"
    const stackTracePattern = /\(([^)]+\.(?:js|ts|jsx|tsx|html|css)):(\d+):(\d+)\)/g;
    
    for (const error of consoleErrors) {
      let match;
      while ((match = stackTracePattern.exec(error)) !== null) {
        filePaths.push(match[1]);
      }
    }
    
    return [...new Set(filePaths)]; // Remove duplicates
  }

  /**
   * Extract keywords from bug description
   */
  static extractKeywords(bugDescription: string): string[] {
    // Common stop words to filter out
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'as', 'by', 'from', 'with', 'is', 'are', 'was', 'were', 'be',
      'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'should', 'can', 'could', 'may', 'might', 'must', 'when',
      'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'this', 'that',
      'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'not',
      'no', 'yes', 'my', 'your', 'his', 'her', 'its', 'our', 'their'
    ]);

    // Extract words, filter stop words, and keep meaningful ones
    const words = bugDescription
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Return unique keywords
    return [...new Set(words)];
  }
}
