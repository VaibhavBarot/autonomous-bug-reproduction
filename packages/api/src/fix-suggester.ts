import OpenAI from 'openai';
import * as path from 'path';
import chalk from 'chalk';
import { ReportParser, BugReport } from './report-parser';
import { FileAnalyzer, AnalyzedFile } from './file-analyzer';

export interface FixSuggestion {
    analysis: string;
    affectedFiles: string[];
    fixes: FileFix[];
    diffOutput: string;
}

export interface FileFix {
    filePath: string;
    explanation: string;
    diff: string;
}

export class FixSuggester {
    private client: OpenAI;
    private model: string;

    constructor(apiKey: string, model: string = 'gemini-2.5-pro') {
        this.model = model;

        // Configure OpenAI client for Gemini endpoint
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
        });
    }

    /**
     * Suggest fixes for a bug based on the reproduction report
     */
    async suggestFixes(
        runId: string,
        codebasePath: string,
        verbose: boolean = false
    ): Promise<FixSuggestion> {
        // Step 1: Parse the bug report
        if (verbose) {
            console.log(chalk.cyan('\n📊 Parsing bug report...'));
        }

        const bugReport = await ReportParser.parse(runId);

        if (verbose) {
            console.log(chalk.green(`✓ Bug: ${bugReport.bugDescription}`));
            console.log(chalk.green(`✓ Status: ${bugReport.status}`));
            console.log(chalk.green(`✓ Steps: ${bugReport.stepsTaken}`));
            console.log(chalk.green(`✓ Console Errors: ${bugReport.consoleErrors.length}`));
            console.log(chalk.green(`✓ Network Requests: ${bugReport.networkRequests.length}`));
        }

        // Step 2: Analyze and find relevant files
        if (verbose) {
            console.log(chalk.cyan('\n🔍 Analyzing codebase for relevant files...'));
        }

        const relevantFiles = await FileAnalyzer.findRelevantFiles(
            path.resolve(process.cwd(), codebasePath),
            bugReport
        );

        if (verbose) {
            console.log(chalk.green(`✓ Found ${relevantFiles.length} relevant files:`));
            relevantFiles.forEach(file => {
                const color = file.relevance === 'high' ? chalk.red :
                    file.relevance === 'medium' ? chalk.yellow : chalk.gray;
                console.log(color(`  - ${file.relativePath} (${file.relevance}): ${file.reason}`));
            });
        }

        if (relevantFiles.length === 0) {
            throw new Error('No relevant files found in codebase. Try adjusting the codebase path.');
        }

        // Step 3: Build prompt for LLM
        if (verbose) {
            console.log(chalk.cyan('\n🤖 Sending request to Gemini API...'));
        }

        const prompt = this.buildPrompt(bugReport, relevantFiles);

        // Step 4: Get fix suggestions from LLM
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert software engineer specializing in debugging and fixing web applications. You provide clear, actionable code fixes in unified diff format.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.2
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('No response from Gemini API');
        }

        if (verbose) {
            console.log(chalk.green('✓ Received fix suggestions from Gemini'));
        }

        // Step 5: Parse the response
        return this.parseResponse(content, relevantFiles);
    }

    /**
     * Build the prompt for the LLM
     */
    private buildPrompt(bugReport: BugReport, relevantFiles: AnalyzedFile[]): string {
        let prompt = `# Bug Fix Analysis Request

I need help fixing a bug that was automatically reproduced by a testing system. Please analyze the bug report and source code, then provide specific code fixes in unified diff format.

## Bug Report

**Description**: ${bugReport.bugDescription}
**Status**: ${bugReport.status.toUpperCase()}
**Duration**: ${bugReport.duration} seconds
**Steps Taken**: ${bugReport.stepsTaken}

### Execution Steps

`;

        // Add execution steps
        bugReport.steps.forEach(step => {
            prompt += `**Step ${step.stepNumber}**\n`;
            if (step.thought) {
                prompt += `- Thought: ${step.thought}\n`;
            }
            prompt += `- Action: ${step.action.type} on \`${step.action.selector}\``;
            if (step.action.text) {
                prompt += ` with text "${step.action.text}"`;
            }
            prompt += `\n- Result: Navigated to ${step.url}\n\n`;
        });

        // Add console errors
        if (bugReport.consoleErrors.length > 0) {
            prompt += `### Console Errors\n\n`;
            bugReport.consoleErrors.forEach(error => {
                prompt += `- ${error}\n`;
            });
            prompt += '\n';
        }

        // Add network activity with focus on errors
        const failedRequests = bugReport.networkRequests.filter(req =>
            req.status && (req.status >= 400 || req.status < 200)
        );

        if (failedRequests.length > 0) {
            prompt += `### Failed Network Requests\n\n`;
            failedRequests.forEach(req => {
                prompt += `- ${req.method} ${req.url} (${req.status})\n`;
                prompt += `  Path: ${req.path}\n`;
            });
            prompt += '\n';
        }

        // Add successful requests for context
        const successfulRequests = bugReport.networkRequests.filter(req =>
            req.status && req.status >= 200 && req.status < 400
        );

        if (successfulRequests.length > 0) {
            prompt += `### Successful Network Requests (for context)\n\n`;
            successfulRequests.slice(0, 5).forEach(req => {
                prompt += `- ${req.method} ${req.url} (${req.status})\n`;
            });
            prompt += '\n';
        }

        // Add relevant source files
        prompt += `## Source Code Files\n\n`;
        prompt += `The following files were identified as potentially related to this bug:\n\n`;

        relevantFiles.forEach((file, index) => {
            prompt += `### File ${index + 1}: ${file.relativePath}\n`;
            prompt += `**Relevance**: ${file.relevance}\n`;
            prompt += `**Reason**: ${file.reason}\n\n`;
            prompt += '```' + this.getFileExtension(file.path) + '\n';

            // Add line numbers to make it easier to reference
            const lines = file.content.split('\n');
            lines.forEach((line, lineIndex) => {
                prompt += `${String(lineIndex + 1).padStart(4, ' ')}: ${line}\n`;
            });

            prompt += '```\n\n';
        });

        // Add instructions
        prompt += `## Instructions

Please analyze this bug and provide:

1. **Root Cause Analysis**: Explain what's causing the bug based on the evidence above.

2. **Fix Suggestions**: Provide specific code changes needed to fix the bug. For each file that needs to be modified:
   - Explain what needs to change and why
   - Provide the fix in unified diff format (standard git diff format)
   - Include context lines for clarity

3. **Verification**: Briefly explain how to verify the fix works.

## Output Format

Please structure your response as follows:

### Analysis
[Your root cause analysis here]

### Fixes

#### File: [relative/path/to/file]
[Explanation of what needs to change]

\`\`\`diff
[Unified diff here]
\`\`\`

[Repeat for each file that needs changes]

### Verification
[How to verify the fix]

Remember to:
- Use proper unified diff format (--- and +++ headers, @@ line numbers, - for removed lines, + for added lines)
- Include a few lines of context before and after changes
- Be specific about line numbers and exact changes needed
- Focus on minimal changes that fix the root cause
`;

        return prompt;
    }

    /**
     * Parse the LLM response to extract fixes
     */
    private parseResponse(content: string, relevantFiles: AnalyzedFile[]): FixSuggestion {
        // Extract analysis section
        const analysisMatch = content.match(/###?\s*Analysis\s*\n([\s\S]*?)(?=###?\s*Fix|$)/i);
        const analysis = analysisMatch ? analysisMatch[1].trim() : 'Analysis not provided';

        // Extract fixes
        const fixes: FileFix[] = [];
        const affectedFiles: string[] = [];

        // Match file-specific fix sections
        const fileFixPattern = /####?\s*File:\s*([^\n]+)\s*\n([\s\S]*?)(?=####?\s*File:|###?\s*Verification|$)/gi;
        let match;

        while ((match = fileFixPattern.exec(content)) !== null) {
            const filePath = match[1].trim();
            const fixContent = match[2];

            // Extract explanation (text before diff block)
            const explanationMatch = fixContent.match(/([\s\S]*?)```diff/);
            const explanation = explanationMatch ? explanationMatch[1].trim() : '';

            // Extract diff blocks
            const diffMatches = fixContent.matchAll(/```diff\s*\n([\s\S]*?)```/g);
            let diff = '';

            for (const diffMatch of diffMatches) {
                diff += diffMatch[1] + '\n';
            }

            if (diff.trim()) {
                fixes.push({
                    filePath,
                    explanation,
                    diff: diff.trim()
                });
                affectedFiles.push(filePath);
            }
        }

        // If no specific file fixes found, try to extract all diff blocks
        if (fixes.length === 0) {
            const allDiffs = content.matchAll(/```diff\s*\n([\s\S]*?)```/g);
            let combinedDiff = '';

            for (const diffMatch of allDiffs) {
                combinedDiff += diffMatch[1] + '\n\n';
            }

            if (combinedDiff.trim()) {
                fixes.push({
                    filePath: 'multiple files',
                    explanation: 'Multiple files need changes',
                    diff: combinedDiff.trim()
                });
            }
        }

        // Build complete diff output
        const diffOutput = fixes.map(fix => fix.diff).join('\n\n');

        return {
            analysis,
            affectedFiles,
            fixes,
            diffOutput
        };
    }

    /**
     * Get file extension for syntax highlighting
     */
    private getFileExtension(filePath: string): string {
        const ext = path.extname(filePath).substring(1);
        const langMap: Record<string, string> = {
            'js': 'javascript',
            'ts': 'typescript',
            'jsx': 'javascript',
            'tsx': 'typescript',
            'html': 'html',
            'css': 'css',
            'json': 'json'
        };
        return langMap[ext] || ext;
    }
}
