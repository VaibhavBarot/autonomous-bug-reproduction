import { Octokit } from '@octokit/rest';

export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  branch: string;
  repoUrl: string;
}

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
    });
  }

  /**
   * Get PR details
   */
  async getPRDetails(owner: string, repo: string, prNumber: number) {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      owner,
      repo,
      prNumber,
      branch: data.head.ref,
      repoUrl: data.head.repo?.clone_url || data.head.repo?.html_url,
      title: data.title,
      body: data.body,
    };
  }

  /**
   * Post comment on PR
   */
  async postPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    comment: string
  ): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment,
    });
  }

  /**
   * Create check run (alternative to comments)
   */
  async createCheckRun(
    owner: string,
    repo: string,
    name: string,
    headSha: string,
    status: 'completed' | 'in_progress',
    conclusion?: 'success' | 'failure' | 'neutral',
    output?: {
      title: string;
      summary: string;
    }
  ) {
    await this.octokit.checks.create({
      owner,
      repo,
      name,
      head_sha: headSha,
      status,
      conclusion,
      output,
    });
  }

  /**
   * Upload file to PR as a comment attachment or create a file in the repo
   */
  async uploadReportToPR(
    owner: string,
    repo: string,
    prNumber: number,
    reportContent: string,
    fileName: string = 'bugbot-report.md'
  ): Promise<void> {
    // For now, we'll post the report as a comment
    // In the future, you could push it to a branch or use GitHub Actions artifacts
    const reportComment = `## 📊 BugBot Test Report\n\n\`\`\`markdown\n${reportContent}\n\`\`\``;
    
    await this.postPRComment(owner, repo, prNumber, reportComment);
  }

  /**
   * Get PR head SHA for creating commits
   */
  async getPRHeadSha(owner: string, repo: string, prNumber: number): Promise<string> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    return data.head.sha;
  }
}

