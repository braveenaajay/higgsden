import { randomInt } from 'node:crypto';
import { fakeSha } from './github.js';
import type { Sandbox } from './sandbox.js';

export const RESOURCE_KINDS = [
  'github_repository',
  'ecr_repository',
  'database',
  'secret',
  'dns_record',
  'codebuild_project',
  'namespace',
  'ingress_route',
  'argo_application',
  'log_routing',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface BuildResult {
  buildId: string;
  status: 'SUCCEEDED' | 'FAILED';
  durationSeconds: number;
  imageUri: string | null;
  logLines: { level: 'info' | 'error'; message: string }[];
}

export interface BuildProvider {
  readonly mode: 'fake' | 'real';
  /** Runs the repository's buildspec.yml in the CodeBuild project and waits for the result. */
  run(input: { codebuildProject: string; repository: string; commitSha: string; kind: 'theme' | 'app'; ecrRepository?: string; failureHint?: boolean }): Promise<BuildResult>;
}

export interface SecretsProvider {
  readonly mode: 'fake' | 'real';
  put(name: string, value: string, tags: Record<string, string>): Promise<{ arn: string }>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
}

export interface InfraResource {
  kind: ResourceKind;
  name: string;
  tags: Record<string, string>;
  spec: Record<string, unknown>;
}

/** Crossplane-backed resources. The real implementation reads claim conditions from the hosting cluster. */
export interface InfraProvider {
  readonly mode: 'fake' | 'real';
  /** Waits for the managed resource to be ready. Idempotent on kind and name. */
  ensure(resource: InfraResource): Promise<{ externalId: string; details: Record<string, unknown>; created: boolean }>;
  remove(kind: ResourceKind, name: string): Promise<void>;
  snapshotDatabase(name: string): Promise<{ identifier: string }>;
}

export interface ArgoProvider {
  readonly mode: 'fake' | 'real';
  sync(application: string, revision: string): Promise<{ health: 'Healthy' | 'Degraded'; sync: 'Synced' | 'OutOfSync'; revision: string }>;
}

export const FAKE_ACCOUNT_ID = '000000000000';

/** Simulates CodeBuild: the buildspec phases, a Docker build for apps, and an ECR push tagged with the commit SHA. */
export class FakeCodeBuild implements BuildProvider {
  readonly mode = 'fake' as const;

  constructor(private readonly region: string) {}

  async run(input: { codebuildProject: string; repository: string; commitSha: string; kind: 'theme' | 'app'; ecrRepository?: string; failureHint?: boolean }): Promise<BuildResult> {
    const buildId = `${input.codebuildProject}:${crypto.randomUUID()}`;
    const short = input.commitSha.slice(0, 12);
    const lines: BuildResult['logLines'] = [
      { level: 'info', message: `[Container] Entering phase INSTALL for ${input.repository}@${short}` },
      { level: 'info', message: '[Container] Running command pnpm install --frozen-lockfile' },
      { level: 'info', message: '[Container] Entering phase PRE_BUILD' },
    ];
    if (input.kind === 'theme') {
      lines.push({ level: 'info', message: '[Container] Running command shopify theme check --fail-level error' });
    } else {
      lines.push(
        { level: 'info', message: `[Container] Running command aws ecr get-login-password | docker login ${FAKE_ACCOUNT_ID}.dkr.ecr.${this.region}.amazonaws.com` },
        { level: 'info', message: '[Container] Entering phase BUILD' },
        { level: 'info', message: `[Container] Running command docker build -t ${input.ecrRepository}:${input.commitSha} .` },
      );
    }
    if (input.failureHint) {
      lines.push(
        { level: 'error', message: 'Error: Test failed: cart.test.ts > applies gift message > expected 200 characters, received 201' },
        { level: 'error', message: '[Container] Command did not exit successfully pnpm test exit status 1' },
        { level: 'error', message: 'Phase complete: BUILD State: FAILED' },
      );
      return { buildId, status: 'FAILED', durationSeconds: 94, imageUri: null, logLines: lines };
    }
    const imageUri = input.kind === 'app' ? `${FAKE_ACCOUNT_ID}.dkr.ecr.${this.region}.amazonaws.com/${input.ecrRepository}:${input.commitSha}` : null;
    if (imageUri) lines.push({ level: 'info', message: `[Container] Running command docker push ${imageUri}` });
    lines.push({ level: 'info', message: 'Phase complete: POST_BUILD State: SUCCEEDED' });
    return { buildId, status: 'SUCCEEDED', durationSeconds: 120 + randomInt(0, 180), imageUri, logLines: lines };
  }
}

export class FakeSecrets implements SecretsProvider {
  readonly mode = 'fake' as const;

  constructor(
    private readonly sandbox: Sandbox,
    private readonly region: string,
  ) {}

  async put(name: string, value: string, tags: Record<string, string>) {
    // The fake keeps only a fingerprint. Secret values are never readable back through the product.
    await this.sandbox.put('aws_secret', name, { tags, length: value.length, fingerprint: fakeSha(value).slice(0, 8) });
    return { arn: `arn:aws:secretsmanager:${this.region}:${FAKE_ACCOUNT_ID}:secret:${name}` };
  }

  async exists(name: string) {
    return (await this.sandbox.get('aws_secret', name)) !== null;
  }

  async remove(name: string) {
    await this.sandbox.remove('aws_secret', name);
  }
}

/** Stands in for Crossplane and the AWS provider. Fault keys `infra:<kind>:<name>` make one call fail, for resume tests. */
export class FakeInfra implements InfraProvider {
  readonly mode = 'fake' as const;

  constructor(
    private readonly sandbox: Sandbox,
    private readonly region: string,
  ) {}

  async ensure(resource: InfraResource) {
    if (await this.sandbox.takeFault(`infra:${resource.kind}:${resource.name}`)) {
      throw new Error(`Simulated failure creating ${resource.kind} ${resource.name}`);
    }
    const existing = await this.sandbox.get<{ externalId: string; details: Record<string, unknown> }>(`aws_${resource.kind}`, resource.name);
    if (existing) return { ...existing, created: false };
    const externalId = this.externalId(resource);
    const details = { ...resource.spec, region: this.region };
    await this.sandbox.put(`aws_${resource.kind}`, resource.name, { externalId, details, tags: resource.tags });
    return { externalId, details, created: true };
  }

  private externalId(r: InfraResource): string {
    switch (r.kind) {
      case 'ecr_repository':
        return `${FAKE_ACCOUNT_ID}.dkr.ecr.${this.region}.amazonaws.com/${r.name}`;
      case 'database':
        return `${String(r.spec.instance ?? 'shared')}/${r.name}`;
      case 'secret':
        return `arn:aws:secretsmanager:${this.region}:${FAKE_ACCOUNT_ID}:secret:${r.name}`;
      case 'codebuild_project':
        return `arn:aws:codebuild:${this.region}:${FAKE_ACCOUNT_ID}:project/${r.name}`;
      case 'dns_record':
        return `Z${randomInt(10_000_000, 99_999_999)}/${r.name}`;
      default:
        return r.name;
    }
  }

  async remove(kind: ResourceKind, name: string) {
    await this.sandbox.remove(`aws_${kind}`, name);
  }

  async snapshotDatabase(name: string) {
    const identifier = `${name.replaceAll(/[^a-z0-9-]/gi, '-')}-final-${Date.now()}`;
    await this.sandbox.put('aws_db_snapshot', identifier, { database: name });
    return { identifier };
  }
}

export class FakeArgo implements ArgoProvider {
  readonly mode = 'fake' as const;

  constructor(private readonly sandbox: Sandbox) {}

  async sync(application: string, revision: string) {
    await this.sandbox.put('argo_application', application, { revision, syncedAt: new Date().toISOString() });
    return { health: 'Healthy' as const, sync: 'Synced' as const, revision };
  }
}
