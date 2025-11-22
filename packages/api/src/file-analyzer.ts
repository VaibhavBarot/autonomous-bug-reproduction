import * as fs from 'fs-extra';
import * as path from 'path';
import { BugReport } from './report-parser';

export interface AnalyzedFile {
    path: string;
    relativePath: string;
    content: string;
    relevance: 'high' | 'medium' | 'low';
    reason: string;
}

export class FileAnalyzer {
    private static readonly CODE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json'];
    private static readonly SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'videos'];
    private static readonly MAX_FILES = 10;
    private static readonly MAX_FILE_SIZE = 500 * 1024; // 500KB

    /**
     * Find relevant files based on bug report analysis
     */
    static async findRelevantFiles(
        codebasePath: string,
        bugReport: BugReport
    ): Promise<AnalyzedFile[]> {
        if (!await fs.pathExists(codebasePath)) {
            throw new Error(`Codebase path not found: ${codebasePath}`);
        }

        const analyzedFiles: AnalyzedFile[] = [];

        // Strategy 1: Find files related to 404 errors (routing issues)
        const notFoundRequests = bugReport.networkRequests.filter(req => req.status === 404);
        if (notFoundRequests.length > 0) {
            const routingFiles = await this.findRoutingFiles(codebasePath, notFoundRequests);
            analyzedFiles.push(...routingFiles);
        }

        // Strategy 2: Find files from console error stack traces
        const stackTraceFiles = await this.findFilesFromStackTraces(codebasePath, bugReport.consoleErrors);
        analyzedFiles.push(...stackTraceFiles);

        // Strategy 3: Find files by keywords from bug description
        const keywordFiles = await this.findFilesByKeywords(codebasePath, bugReport.bugDescription);
        analyzedFiles.push(...keywordFiles);

        // Strategy 4: Find files related to API endpoints
        const apiFiles = await this.findApiFiles(codebasePath, bugReport.networkRequests);
        analyzedFiles.push(...apiFiles);

        // Remove duplicates and sort by relevance
        const uniqueFiles = this.deduplicateFiles(analyzedFiles);
        const sortedFiles = uniqueFiles.sort((a, b) => {
            const relevanceOrder = { high: 0, medium: 1, low: 2 };
            return relevanceOrder[a.relevance] - relevanceOrder[b.relevance];
        });

        // Limit to MAX_FILES
        return sortedFiles.slice(0, this.MAX_FILES);
    }

    /**
     * Find files that might contain routing configuration or navigation links
     */
    private static async findRoutingFiles(
        codebasePath: string,
        notFoundRequests: Array<{ path: string; url: string }>
    ): Promise<AnalyzedFile[]> {
        const files: AnalyzedFile[] = [];
        const allFiles = await this.getAllFiles(codebasePath);

        for (const file of allFiles) {
            try {
                const content = await fs.readFile(file, 'utf-8');

                // Check if file contains references to the 404 paths
                for (const req of notFoundRequests) {
                    const searchPath = req.path;

                    // Look for href, to, router paths, etc.
                    if (
                        content.includes(`href="${searchPath}"`) ||
                        content.includes(`href='${searchPath}'`) ||
                        content.includes(`to="${searchPath}"`) ||
                        content.includes(`to='${searchPath}'`) ||
                        content.includes(`path: "${searchPath}"`) ||
                        content.includes(`path: '${searchPath}'`) ||
                        content.includes(`'${searchPath}'`) ||
                        content.includes(`"${searchPath}"`)
                    ) {
                        files.push({
                            path: file,
                            relativePath: path.relative(codebasePath, file),
                            content,
                            relevance: 'high',
                            reason: `Contains reference to 404 path: ${searchPath}`
                        });
                        break; // Don't check other requests for this file
                    }
                }
            } catch (error) {
                // Skip files that can't be read
                continue;
            }
        }

        return files;
    }

    /**
     * Find files mentioned in console error stack traces
     */
    private static async findFilesFromStackTraces(
        codebasePath: string,
        consoleErrors: string[]
    ): Promise<AnalyzedFile[]> {
        const files: AnalyzedFile[] = [];
        const stackTracePattern = /\(([^)]+\.(?:js|ts|jsx|tsx)):(\d+):(\d+)\)/g;

        for (const error of consoleErrors) {
            let match;
            while ((match = stackTracePattern.exec(error)) !== null) {
                const filePath = match[1];
                const fullPath = path.isAbsolute(filePath) ? filePath : path.join(codebasePath, filePath);

                if (await fs.pathExists(fullPath)) {
                    try {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        files.push({
                            path: fullPath,
                            relativePath: path.relative(codebasePath, fullPath),
                            content,
                            relevance: 'high',
                            reason: `Referenced in console error stack trace`
                        });
                    } catch {
                        continue;
                    }
                }
            }
        }

        return files;
    }

    /**
     * Find files by keywords from bug description
     */
    private static async findFilesByKeywords(
        codebasePath: string,
        bugDescription: string
    ): Promise<AnalyzedFile[]> {
        const keywords = this.extractKeywords(bugDescription);
        if (keywords.length === 0) return [];

        const files: AnalyzedFile[] = [];
        const allFiles = await this.getAllFiles(codebasePath);

        for (const file of allFiles) {
            try {
                const content = await fs.readFile(file, 'utf-8');
                const fileName = path.basename(file, path.extname(file)).toLowerCase();

                // Check if filename or content contains keywords
                const matchedKeywords = keywords.filter(keyword =>
                    fileName.includes(keyword.toLowerCase()) ||
                    content.toLowerCase().includes(keyword.toLowerCase())
                );

                if (matchedKeywords.length > 0) {
                    files.push({
                        path: file,
                        relativePath: path.relative(codebasePath, file),
                        content,
                        relevance: matchedKeywords.length >= 2 ? 'medium' : 'low',
                        reason: `Matches keywords: ${matchedKeywords.join(', ')}`
                    });
                }
            } catch {
                continue;
            }
        }

        return files;
    }

    /**
     * Find files related to API endpoints
     */
    private static async findApiFiles(
        codebasePath: string,
        networkRequests: Array<{ path: string; method: string }>
    ): Promise<AnalyzedFile[]> {
        const files: AnalyzedFile[] = [];
        const apiRequests = networkRequests.filter(req => req.path.startsWith('/api/'));

        if (apiRequests.length === 0) return [];

        const allFiles = await this.getAllFiles(codebasePath);

        for (const file of allFiles) {
            // Look for server/backend files
            if (
                file.includes('server.') ||
                file.includes('api.') ||
                file.includes('routes.') ||
                file.includes('app.')
            ) {
                try {
                    const content = await fs.readFile(file, 'utf-8');

                    // Check if file contains API route definitions
                    for (const req of apiRequests) {
                        const routePath = req.path;
                        if (
                            content.includes(`'${routePath}'`) ||
                            content.includes(`"${routePath}"`) ||
                            content.includes(`\`${routePath}\``)
                        ) {
                            files.push({
                                path: file,
                                relativePath: path.relative(codebasePath, file),
                                content,
                                relevance: 'high',
                                reason: `Defines API route: ${routePath}`
                            });
                            break;
                        }
                    }
                } catch {
                    continue;
                }
            }
        }

        return files;
    }

    /**
     * Get all code files recursively
     */
    private static async getAllFiles(dirPath: string): Promise<string[]> {
        const files: string[] = [];

        async function traverse(currentPath: string) {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);

                if (entry.isDirectory()) {
                    // Skip certain directories
                    if (FileAnalyzer.SKIP_DIRS.includes(entry.name)) {
                        continue;
                    }
                    await traverse(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    const stats = await fs.stat(fullPath);

                    // Only include code files within size limit
                    if (
                        FileAnalyzer.CODE_EXTENSIONS.includes(ext) &&
                        stats.size <= FileAnalyzer.MAX_FILE_SIZE
                    ) {
                        files.push(fullPath);
                    }
                }
            }
        }

        await traverse(dirPath);
        return files;
    }

    /**
     * Remove duplicate files (same path)
     */
    private static deduplicateFiles(files: AnalyzedFile[]): AnalyzedFile[] {
        const seen = new Map<string, AnalyzedFile>();

        for (const file of files) {
            const existing = seen.get(file.path);

            // Keep the file with higher relevance if duplicate
            if (!existing || this.compareRelevance(file.relevance, existing.relevance) > 0) {
                seen.set(file.path, file);
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Compare relevance levels (higher is better)
     */
    private static compareRelevance(a: string, b: string): number {
        const order = { high: 3, medium: 2, low: 1 };
        return order[a as keyof typeof order] - order[b as keyof typeof order];
    }

    /**
     * Extract meaningful keywords from text
     */
    private static extractKeywords(text: string): string[] {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'as', 'by', 'from', 'with', 'is', 'are', 'was', 'were', 'be',
            'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'should', 'can', 'could', 'may', 'might', 'must', 'when',
            'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'this', 'that',
            'these', 'those', 'not', 'doesn', 'doesn\'t', 'clicking', 'click', 'button'
        ]);

        const words = text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word));

        return [...new Set(words)];
    }
}
