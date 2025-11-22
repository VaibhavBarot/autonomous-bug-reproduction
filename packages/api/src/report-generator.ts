import { ArtifactPaths } from './artifact-manager';
import { AgentAction, AgentObservation } from '@bugbot/agent';
import { NetworkEntry } from '@bugbot/runner';

export interface ReportData {
  bugDescription: string;
  startTime: Date;
  endTime: Date;
  status: 'reproduced' | 'failed' | 'timeout';
  steps: Array<{
    stepNumber: number;
    action: AgentAction;
    observation: AgentObservation;
    thought?: string;
  }>;
  networkEntries: NetworkEntry[];
  consoleErrors: string[];
  artifacts: ArtifactPaths;
}

export class ReportGenerator {
  static generateHTML(data: ReportData): string {
    const duration = Math.round((data.endTime.getTime() - data.startTime.getTime()) / 1000);
    const statusColor = data.status === 'reproduced' ? '#ef4444' : data.status === 'failed' ? '#f59e0b' : '#6b7280';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bug Reproduction Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 30px;
        }
        h1 {
            color: #1f2937;
            border-bottom: 3px solid ${statusColor};
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .header {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
        }
        .header-item {
            background: #f9fafb;
            padding: 15px;
            border-radius: 6px;
        }
        .header-item strong {
            color: #6b7280;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .header-item p {
            margin-top: 5px;
            font-size: 1.1em;
            color: #1f2937;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: 600;
            background: ${statusColor}20;
            color: ${statusColor};
        }
        .steps {
            margin-top: 30px;
        }
        .step {
            border-left: 4px solid #e5e7eb;
            padding: 20px;
            margin-bottom: 20px;
            background: #f9fafb;
            border-radius: 4px;
        }
        .step-number {
            font-weight: 700;
            color: #6b7280;
            font-size: 0.9em;
            margin-bottom: 10px;
        }
        .action {
            background: #dbeafe;
            padding: 12px;
            border-radius: 4px;
            margin: 10px 0;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 0.9em;
        }
        .thought {
            color: #6b7280;
            font-style: italic;
            margin: 10px 0;
            padding-left: 15px;
            border-left: 2px solid #e5e7eb;
        }
        .observation {
            margin-top: 10px;
            padding: 10px;
            background: white;
            border-radius: 4px;
            font-size: 0.9em;
        }
        .observation-item {
            margin: 5px 0;
            color: #4b5563;
        }
        .network-section, .errors-section {
            margin-top: 30px;
            padding: 20px;
            background: #f9fafb;
            border-radius: 6px;
        }
        .network-entry, .error-entry {
            padding: 10px;
            margin: 5px 0;
            background: white;
            border-radius: 4px;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 0.85em;
        }
        .error-entry {
            color: #dc2626;
        }
        .artifacts {
            margin-top: 30px;
            padding: 20px;
            background: #eff6ff;
            border-radius: 6px;
        }
        .artifacts ul {
            list-style: none;
            margin-top: 10px;
        }
        .artifacts li {
            padding: 5px 0;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 0.9em;
        }
        .conclusion {
            margin-top: 30px;
            padding: 20px;
            background: ${statusColor}10;
            border-left: 4px solid ${statusColor};
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Bug Reproduction Report</h1>
        
        <div class="header">
            <div class="header-item">
                <strong>Bug Description</strong>
                <p>${this.escapeHtml(data.bugDescription)}</p>
            </div>
            <div class="header-item">
                <strong>Status</strong>
                <p><span class="status-badge">${data.status.toUpperCase()}</span></p>
            </div>
            <div class="header-item">
                <strong>Duration</strong>
                <p>${duration} seconds</p>
            </div>
            <div class="header-item">
                <strong>Steps Taken</strong>
                <p>${data.steps.length}</p>
            </div>
        </div>

        <div class="steps">
            <h2>Execution Steps</h2>
            ${data.steps.map((step, idx) => `
                <div class="step">
                    <div class="step-number">Step ${step.stepNumber}</div>
                    ${step.thought ? `<div class="thought">💭 ${this.escapeHtml(step.thought)}</div>` : ''}
                    <div class="action">
                        ${step.action.type.toUpperCase()}: ${this.escapeHtml(step.action.selector)}${step.action.text ? ` - "${this.escapeHtml(step.action.text)}"` : ''}
                    </div>
                    <div class="observation">
                        <div class="observation-item"><strong>URL:</strong> ${this.escapeHtml(step.observation.state.url)}</div>
                        <div class="observation-item"><strong>Title:</strong> ${this.escapeHtml(step.observation.state.title)}</div>
                        <div class="observation-item"><strong>Clickable Elements:</strong> ${step.observation.dom.filter(e => e.clickable).length}</div>
                    </div>
                </div>
            `).join('')}
        </div>

        ${data.consoleErrors.length > 0 ? `
        <div class="errors-section">
            <h2>Console Errors</h2>
            ${data.consoleErrors.map(error => `
                <div class="error-entry">${this.escapeHtml(error)}</div>
            `).join('')}
        </div>
        ` : ''}

        <div class="network-section">
            <h2>Network Activity</h2>
            <p>Total requests: ${data.networkEntries.length}</p>
            ${data.networkEntries.slice(-20).map(entry => `
                <div class="network-entry">
                    ${entry.method} ${this.escapeHtml(entry.url)} ${entry.status ? `(${entry.status})` : '(pending)'}
                </div>
            `).join('')}
        </div>

        <div class="artifacts">
            <h2>Artifacts</h2>
            <ul>
                <li>📹 Video: ${data.artifacts.videoPath || 'Not available'}</li>
                <li>📊 Trace: ${data.artifacts.tracingPath}</li>
                <li>🌐 HAR: ${data.artifacts.harPath}</li>
                <li>📝 Logs: ${data.artifacts.logsPath}</li>
            </ul>
        </div>

        <div class="conclusion">
            <h2>Conclusion</h2>
            <p>
                ${data.status === 'reproduced' 
                    ? '✅ Bug was successfully reproduced. The issue was observed during the test execution.' 
                    : data.status === 'failed'
                    ? '❌ Bug reproduction failed. The agent was unable to reproduce the issue within the given constraints.'
                    : '⏱️ Test timed out before completion.'}
            </p>
        </div>
    </div>
</body>
</html>`;
  }

  static generateMarkdown(data: ReportData): string {
    const duration = Math.round((data.endTime.getTime() - data.startTime.getTime()) / 1000);
    
    return `# Bug Reproduction Report

## Summary

- **Bug Description**: ${data.bugDescription}
- **Status**: ${data.status.toUpperCase()}
- **Duration**: ${duration} seconds
- **Steps Taken**: ${data.steps.length}
- **Start Time**: ${data.startTime.toISOString()}
- **End Time**: ${data.endTime.toISOString()}

## Execution Steps

${data.steps.map((step, idx) => `
### Step ${step.stepNumber}

**Action**: \`${step.action.type}\` on \`${step.action.selector}\`${step.action.text ? ` with text "${step.action.text}"` : ''}

${step.thought ? `**Thought**: ${step.thought}\n` : ''}

**Observation**:
- URL: ${step.observation.state.url}
- Title: ${step.observation.state.title}
- Clickable Elements: ${step.observation.dom.filter(e => e.clickable).length}

`).join('')}

## Console Errors

${data.consoleErrors.length > 0 ? data.consoleErrors.map(e => `- ${e}`).join('\n') : 'None'}

## Network Activity

Total requests: ${data.networkEntries.length}

${data.networkEntries.slice(-20).map(e => `- ${e.method} ${e.url} ${e.status ? `(${e.status})` : '(pending)'}`).join('\n')}

## Artifacts

- Video: ${data.artifacts.videoPath || 'Not available'}
- Trace: ${data.artifacts.tracingPath}
- HAR: ${data.artifacts.harPath}
- Logs: ${data.artifacts.logsPath}

## Conclusion

${data.status === 'reproduced' 
    ? '✅ Bug was successfully reproduced.' 
    : data.status === 'failed'
    ? '❌ Bug reproduction failed.'
    : '⏱️ Test timed out.'}
`;
  }

  private static escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

