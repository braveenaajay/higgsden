import { randomInt } from 'node:crypto';
import type { Sandbox } from './sandbox.js';
import { signGitHub } from './signing.js';

export interface GitHubRepo {
  id: number;
  fullName: string;
  defaultBranch: string;
}

export interface GitHubProvider {
  readonly mode: 'fake' | 'real';
  installUrl(state: string): string;
  getInstallation(installationId: number): Promise<{ accountLogin: string } | null>;
  listRepositories(installationId: number): Promise<GitHubRepo[]>;
  /** Idempotent on owner and name. */
  createRepositoryFromTemplate(installationId: number, input: { owner: string; name: string; templateRepo: string; files: Record<string, string> }): Promise<GitHubRepo>;
  readFile(installationId: number, repo: string, path: string, ref?: string): Promise<string | null>;
  commitFiles(installationId: number, repo: string, input: { branch: string; files: Record<string, string>; message: string }): Promise<{ sha: string }>;
  openPullRequest(installationId: number, repo: string, input: { head: string; base: string; title: string; body: string }): Promise<{ number: number; url: string }>;
  comment(installationId: number, repo: string, number: number, body: string): Promise<void>;
  setStatus(installationId: number, repo: string, sha: string, input: { state: 'pending' | 'success' | 'failure'; context: string; description: string; targetUrl?: string }): Promise<void>;
}

type FakeRepo = GitHubRepo & { installationId: number; nextPr: number };

export interface FakeGitHubOptions {
  publicApiUrl: string;
  /** Where the fake delivers webhooks, like GitHub would. */
  webhookUrl: string;
  webhookSecret: string;
}

/**
 * Stands in for the GitHub App until a real App registration exists.
 * The install page, repository data, and pull requests live in the sandbox table, and webhooks are signed
 * with the same secret and header the real App uses, so the API's webhook path is exercised unchanged.
 */
export class FakeGitHub implements GitHubProvider {
  readonly mode = 'fake' as const;

  constructor(
    private readonly sandbox: Sandbox,
    private readonly options: FakeGitHubOptions,
  ) {}

  installUrl(state: string): string {
    return `${this.options.publicApiUrl}/api/github/fake-install?state=${encodeURIComponent(state)}`;
  }

  /** Called by the fake install page. Creates an installation with three demo repositories. */
  async registerInstallation(accountLogin: string, repoNames = ['storefront-theme', 'wholesale-app', 'subscriptions-app']): Promise<number> {
    const installationId = randomInt(10_000_000, 99_999_999);
    await this.sandbox.put('gh_installation', String(installationId), { accountLogin });
    for (const name of repoNames) await this.addRepo(installationId, `${accountLogin}/${name}`);
    return installationId;
  }

  private async addRepo(installationId: number, fullName: string): Promise<FakeRepo> {
    const existing = await this.sandbox.get<FakeRepo>('gh_repo', fullName);
    if (existing) return existing;
    const repo: FakeRepo = { id: randomInt(100_000_000, 999_999_999), fullName, defaultBranch: 'main', installationId, nextPr: 1 };
    await this.sandbox.put('gh_repo', fullName, repo);
    await this.sandbox.put('gh_file', `${fullName}:main:README.md`, { content: `# ${fullName}\n` });
    return repo;
  }

  async getInstallation(installationId: number) {
    return this.sandbox.get<{ accountLogin: string }>('gh_installation', String(installationId));
  }

  async listRepositories(installationId: number): Promise<GitHubRepo[]> {
    const repos = await this.sandbox.list<FakeRepo>('gh_repo');
    return repos
      .filter((r) => r.data.installationId === installationId)
      .map(({ data }) => ({ id: data.id, fullName: data.fullName, defaultBranch: data.defaultBranch }));
  }

  async createRepositoryFromTemplate(installationId: number, input: { owner: string; name: string; templateRepo: string; files: Record<string, string> }) {
    const repo = await this.addRepo(installationId, `${input.owner}/${input.name}`);
    for (const [path, content] of Object.entries(input.files)) {
      await this.sandbox.put('gh_file', `${repo.fullName}:main:${path}`, { content });
    }
    return { id: repo.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch };
  }

  async readFile(_installationId: number, repo: string, path: string, ref = 'main') {
    const file = await this.sandbox.get<{ content: string }>('gh_file', `${repo}:${ref}:${path}`);
    return file?.content ?? null;
  }

  async commitFiles(_installationId: number, repo: string, input: { branch: string; files: Record<string, string>; message: string }) {
    for (const [path, content] of Object.entries(input.files)) {
      await this.sandbox.put('gh_file', `${repo}:${input.branch}:${path}`, { content });
    }
    return { sha: fakeSha(`${repo}:${input.branch}:${input.message}:${Date.now()}`) };
  }

  async openPullRequest(installationId: number, repoName: string, input: { head: string; base: string; title: string; body: string }) {
    const repo = await this.sandbox.get<FakeRepo>('gh_repo', repoName);
    if (!repo) throw new Error(`Unknown repository ${repoName}`);
    const number = repo.nextPr;
    await this.sandbox.put('gh_repo', repoName, { ...repo, nextPr: number + 1 });
    const url = `https://github.com/${repoName}/pull/${number}`;
    await this.deliver('pull_request', {
      action: 'opened',
      installation: { id: installationId },
      repository: { id: repo.id, full_name: repoName },
      pull_request: {
        number,
        html_url: url,
        title: input.title,
        body: input.body,
        state: 'open',
        merged: false,
        head: { ref: input.head, sha: fakeSha(`${repoName}:${input.head}`) },
        created_at: new Date().toISOString(),
      },
    });
    return { number, url };
  }

  async comment(_installationId: number, repo: string, number: number, body: string) {
    await this.sandbox.put('gh_comment', `${repo}#${number}:${Date.now()}`, { body });
  }

  async setStatus(_installationId: number, repo: string, sha: string, input: { state: string; context: string; description: string; targetUrl?: string }) {
    await this.sandbox.put('gh_status', `${repo}@${sha}:${input.context}`, input);
  }

  /** Signs and posts a webhook the way GitHub does. */
  async deliver(event: string, payload: Record<string, unknown>, deliveryId: string = crypto.randomUUID()): Promise<number> {
    const body = JSON.stringify(payload);
    const res = await fetch(this.options.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': signGitHub(this.options.webhookSecret, body),
      },
      body,
    });
    return res.status;
  }
}

export function fakeSha(seed: string): string {
  let h = 0n;
  for (const c of seed) h = (h * 131n + BigInt(c.charCodeAt(0))) % (1n << 160n);
  return h.toString(16).padStart(40, '0').slice(0, 40);
}
