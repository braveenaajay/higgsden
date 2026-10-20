import type { Db } from '@higgsden/db';
import { FakeStripe, RealStripe, type BillingProvider } from './billing.js';
import { FakeArgo, FakeCodeBuild, FakeInfra, FakeSecrets, type ArgoProvider, type BuildProvider, type InfraProvider, type SecretsProvider } from './cloud.js';
import { HttpEmbeddingClient, type EmbeddingClient } from './embeddings.js';
import { FakeGitHub, type GitHubProvider } from './github.js';
import { ClaudeLlm, RecordedLlm, type LlmProvider } from './llm.js';
import { SmtpMailer, type Mailer } from './mailer.js';
import { Sandbox } from './sandbox.js';
import { FakeShopify, type ThemeProvider } from './shopify.js';

export * from './billing.js';
export * from './cloud.js';
export * from './embeddings.js';
export * from './github.js';
export * from './llm.js';
export * from './mailer.js';
export * from './sandbox.js';
export * from './shopify.js';
export * from './signing.js';

export interface IntegrationConfig {
  publicUrl: string;
  internalApiUrl: string;
  awsRegion: string;
  githubWebhookSecret: string;
  stripeWebhookSecret: string;
  stripeSecretKey?: string;
  anthropicApiKey?: string;
  claudeModel: string;
  embeddingServiceUrl: string;
  embeddingServiceToken: string;
  smtp: { host: string; port: number; user?: string; password?: string };
  mailFrom: string;
}

export function integrationConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IntegrationConfig {
  return {
    publicUrl: env.PUBLIC_URL ?? 'http://localhost:8080',
    internalApiUrl: env.INTERNAL_API_URL ?? 'http://localhost:3000',
    awsRegion: env.AWS_REGION ?? 'us-east-1',
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET ?? 'dev-github-webhook-secret',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? 'whsec_dev_stripe_webhook_secret',
    stripeSecretKey: env.STRIPE_SECRET_KEY || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    claudeModel: env.CLAUDE_MODEL ?? 'claude-sonnet-4-5',
    embeddingServiceUrl: env.EMBEDDING_SERVICE_URL ?? 'http://localhost:8000',
    embeddingServiceToken: env.EMBEDDING_SERVICE_TOKEN ?? 'dev-embedding-service-token',
    smtp: {
      host: env.SMTP_HOST ?? 'localhost',
      port: Number(env.SMTP_PORT ?? 1025),
      user: env.SMTP_USER || undefined,
      password: env.SMTP_PASSWORD || undefined,
    },
    mailFrom: env.MAIL_FROM ?? 'HiggsDEN <no-reply@higgsden.test>',
  };
}

export interface Providers {
  config: IntegrationConfig;
  sandbox: Sandbox;
  github: GitHubProvider;
  billing: BillingProvider;
  themes: ThemeProvider;
  builds: BuildProvider;
  secrets: SecretsProvider;
  infra: InfraProvider;
  argo: ArgoProvider;
  llm: LlmProvider;
  embeddings: EmbeddingClient;
  mailer: Mailer;
}

/**
 * GitHub, Shopify, and AWS use local fakes until those accounts exist. Stripe and Claude switch to the real
 * services as soon as their keys are set. Every fake keeps the same interface the real adapter will implement.
 */
export function createProviders(db: Db, config: IntegrationConfig = integrationConfigFromEnv()): Providers {
  const sandbox = new Sandbox(db);
  return {
    config,
    sandbox,
    github: new FakeGitHub(sandbox, {
      publicApiUrl: config.publicUrl,
      webhookUrl: `${config.internalApiUrl}/api/webhooks/github`,
      webhookSecret: config.githubWebhookSecret,
    }),
    billing: config.stripeSecretKey
      ? new RealStripe(config.stripeSecretKey)
      : new FakeStripe(sandbox, {
          publicApiUrl: config.publicUrl,
          webhookUrl: `${config.internalApiUrl}/api/webhooks/stripe`,
          webhookSecret: config.stripeWebhookSecret,
        }),
    themes: new FakeShopify(sandbox),
    builds: new FakeCodeBuild(config.awsRegion),
    secrets: new FakeSecrets(sandbox, config.awsRegion),
    infra: new FakeInfra(sandbox, config.awsRegion),
    argo: new FakeArgo(sandbox),
    llm: config.anthropicApiKey ? new ClaudeLlm(config.anthropicApiKey, config.claudeModel) : new RecordedLlm(),
    embeddings: new HttpEmbeddingClient(config.embeddingServiceUrl, config.embeddingServiceToken),
    mailer: new SmtpMailer(config.smtp, config.mailFrom),
  };
}

export function providerModes(p: Providers): Record<string, string> {
  return {
    github: p.github.mode,
    stripe: p.billing.mode,
    shopify: p.themes.mode,
    codebuild: p.builds.mode,
    secretsManager: p.secrets.mode,
    crossplane: p.infra.mode,
    argocd: p.argo.mode,
    claude: p.llm.mode,
  };
}
