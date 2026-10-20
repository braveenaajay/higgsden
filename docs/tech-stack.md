# Tech stack

Status: aligned 20 October 2026.
Parent: [alignment.md](alignment.md). Phases: [phase-plan.md](phase-plan.md).

Decisions marked **Locked** were chosen explicitly. Everything else is a recommendation the team can change in this file without touching the alignment.

## Summary

| Layer | Choice | Status | First needed |
| --- | --- | --- | --- |
| Language | TypeScript for the product, Python for the embedding service | Locked | Phase 1 |
| Repository | One pnpm monorepo with Turborepo | Recommended | Phase 1 |
| Web app | React, Vite, TanStack Router, TanStack Query, Tailwind CSS, shadcn/ui | Recommended | Phase 1 |
| API | NestJS on the Fastify adapter | Locked | Phase 1 |
| Authentication | Better Auth, self-hosted, with the organization plugin | Locked | Phase 1 |
| Authorization | NestJS guards and a policy module, plus PostgreSQL row-level security | Recommended | Phase 1 |
| Database | PostgreSQL 16+ on Amazon RDS, with pgvector | Recommended | Phase 1 |
| Data access | Drizzle ORM and drizzle-kit migrations | Recommended | Phase 1 |
| Background work | BullMQ on Redis, with workflow state in PostgreSQL | Locked | Phase 1 |
| Redis | Amazon ElastiCache for Valkey or Redis OSS | Recommended | Phase 1 |
| Billing | Stripe Billing with usage meters | Recommended | Phase 1 |
| Email | Amazon SES | Recommended | Phase 1 |
| GitHub | GitHub App with Octokit | Locked by capability C1 | Phase 1 |
| Microsoft Teams | Microsoft Graph: transcript change notifications, `getAllTranscripts`, VTT content | Planned by capability C12 | Phase 4 |
| Tenant builds | AWS CodeBuild running each repository's `buildspec.yml` | Locked by capability C2 | Phase 2 |
| Images | Docker and Amazon ECR | Locked by capabilities C2, C3 | Phase 2 |
| Runtime | Amazon EKS with Karpenter | Locked by capability C4 | Phase 2 |
| Deployment | Argo CD, GitOps | Locked by capability C4 | Phase 2 |
| Shopify themes | Shopify CLI and the Admin GraphQL API | Recommended | Phase 2 |
| Logs | Fluent Bit to Amazon OpenSearch Service | Locked by capability C10 | Phase 2 |
| Base infrastructure | Terraform | Locked | Phase 2 |
| Per-project infrastructure | Crossplane, committed through GitOps | Locked | Phase 3 |
| Embeddings | Custom Python service: FastAPI and a BullMQ Python worker | Locked | Phase 4 |
| Claude | Claude API with tool use, and the Claude Agent SDK for the implement skill | Recommended, provider open | Phase 4 |
| Realtime | WebSockets through NestJS gateways with the Socket.IO Redis adapter | Recommended | Phase 5 |
| Observability | OpenTelemetry, OpenSearch, Amazon Managed Prometheus, Grafana, Sentry | Recommended | Phase 1 |
| Platform CI | GitHub Actions | Recommended | Phase 1 |
| Testing | Vitest, Playwright, Testcontainers | Recommended | Phase 1 |

## Repository layout

```
higgsden/
├── apps/
│   ├── web/                React app for Agencies and the operator console
│   ├── api/                NestJS modular monolith
│   ├── worker/             NestJS BullMQ workers: webhooks, pipelines, provisioning, agent runs
│   └── embedding-service/  Python FastAPI service and BullMQ Python worker
├── packages/
│   ├── db/                 Drizzle schema, migrations, row-level security policies
│   ├── contracts/          Shared types and zod schemas for API, jobs, and events
│   ├── policy/             Role and Client-assignment rules shared by api and worker
│   └── ui/                 Shared React components
├── infra/
│   ├── terraform/          Platform base infrastructure, per environment
│   ├── crossplane/         Compositions for per-project resources
│   └── gitops/             Argo CD applications for the platform itself
├── templates/              Theme and app project templates (Phase 3)
├── skills/                 Versioned Claude skills (Phase 4)
└── docs/
```

The Python service lives in the same repository and builds with `uv`, but it is not a pnpm workspace package.

## Application

### Web app

- React with Vite, served as static files from S3 and CloudFront. No server-side rendering is needed behind sign-in.
- TanStack Router for type-safe routes, TanStack Query for server state.
- Tailwind CSS and shadcn/ui components.
- One app with two areas: the Agency workspace and the operator console. The operator console is a separate route tree with its own guard.

### API

- NestJS modular monolith. One NestJS module per domain: tenancy, membership, clients, projects, discovery, decisions, backlog, knowledge, github, billing, support, audit. Later phases add shopify, pipelines, deployments, provisioning, logs, ai, and support-desk modules.
- Modules talk through their public services and domain events, never through each other's tables.
- REST with an OpenAPI document generated from the controllers. The web app uses a client generated from that document.
- Every request resolves the Agency from the session and the selected Agency. A request-scoped tenant context carries the Agency id, the member's role, and the assigned Client ids into every query.

### Authentication

- Better Auth stores users, sessions, and accounts in the platform's PostgreSQL.
- Sign-in with email and password, GitHub, and Google.
- Better Auth's organization plugin is mapped to the Agency. Its member roles are replaced by the five product roles in [alignment.md](alignment.md).
- Client assignment is a product table, not part of Better Auth.
- Platform operators are a separate flag on the user, checked only by the operator console guard.
- Enterprise SSO (SAML, SCIM) is not in Phase 1. If an Agency needs it later, add Better Auth's SSO plugin or a provider such as WorkOS behind the same sign-in screen.

### Authorization

- The `policy` package holds one function per action from the Phase 1 permission table. Controllers and workers both call it.
- PostgreSQL row-level security on every tenant table checks `agency_id` against a session setting the API sets on each transaction. It is the second guard beneath the policy module.
- Client assignment filtering stays in the application layer. Row-level security covers only the Agency boundary.

## Data

### PostgreSQL

- Amazon RDS for PostgreSQL 16 or later, Multi-AZ in production, with the `pgvector` extension.
- Drizzle ORM for queries. Row-level security policies, partitioning, and vector indexes are written as SQL in drizzle-kit migrations.
- Every tenant table has `agency_id`. Client-owned tables have `client_id`. Project-owned tables have `project_id`.
- `audit_events` is append-only and partitioned by month.
- `knowledge_chunks` and `embeddings` are partitioned by Agency from Phase 4.
- A read replica serves search and reporting once load needs it.
- Hosted app databases from Phase 3 are separate from the platform database. See per-project infrastructure.

### Redis

- Amazon ElastiCache for Valkey or Redis OSS, with Multi-AZ in production.
- Used for BullMQ queues, rate limiting, and the Socket.IO adapter in Phase 5.
- Not a system of record. Anything that must survive Redis loss is in PostgreSQL first.

## Background work

BullMQ runs every background job. Long, multi-step workflows such as deploys with approval, provisioning, and Claude agent runs are tracked in PostgreSQL so they survive restarts and can wait for a person.

- **Tables.** `workflow_runs` holds type, subject, status, current step, and requested-by. `workflow_steps` holds each step's status, attempts, last error, output, and an idempotency key.
- **Starting.** The API inserts the run and its first step in one transaction, then enqueues the step through a transactional outbox so a job is never lost or duplicated.
- **Executing.** A worker loads the step, does the work, records the result, and enqueues the next step. Retries use BullMQ backoff. A step that exhausts retries marks the run `failed` and moves the job to a dead-letter queue.
- **Waiting for a person.** An approval step sets the run to `waiting_for_approval` and enqueues nothing. The approval action in the API records the approval and enqueues the next step.
- **Resuming.** A failed run can resume from the failed step. Completed steps are skipped by their idempotency key.
- **Webhooks.** GitHub, Shopify, Stripe, and Microsoft Graph transcript notifications are verified, stored with their delivery id, acknowledged immediately, and processed by a job. Duplicate delivery ids are ignored.
- **Queues.** Separate queues per concern (`webhooks`, `email`, `pipelines`, `provisioning`, `agent-runs`, `embeddings`, `teams.transcripts`) so a backlog in one does not delay another. Concurrency is limited per Agency on the pipeline, provisioning, and agent queues so one Agency cannot starve the others.
- **Monitoring.** Queue depth, failure rate, and oldest-job age are exported as metrics. Bull Board is available in the operator console for platform staff only.

## Integrations

### GitHub

- One GitHub App per platform environment (development, production).
- `@octokit/app` for installation tokens and `@octokit/webhooks` for signature checks.
- Installation tokens are minted per job and never stored beyond their expiry.
- Permissions grow by phase as listed in [capability-flow.md](capability-flow.md).

### Microsoft Teams

- One multi-tenant Entra application per platform environment. Agencies admin-consent it onto their Microsoft 365 tenant.
- Microsoft Graph application permissions: `OnlineMeetingTranscript.Read.All`, `OnlineMeetings.Read.All`.
- Listen path: change notifications on `communications/onlineMeetings/getAllTranscripts`, then download `text/vtt` content. Delta query as catch-up.
- Tenant tables: `teams_connections`, `teams_organizers`, `teams_project_maps`, `meeting_transcripts`, `meeting_questions`. Webhook lookup: `resolve_teams_tenant`.
- HiggsDEN does not join the live call. Channel meetings are out of v1. Full contract: [teams-integration.md](teams-integration.md).

### Stripe

- Stripe Billing for subscriptions on the Agency. Trialing, active, past_due, and canceled map to Stripe subscription statuses.
- Stripe usage meters for build minutes, hosted compute, databases, storage, log volume, and AI tokens once each is billed. The platform's own `usage_records` table is written first and reported to Stripe by a job.

### Shopify

- Each Client's store credentials are stored in AWS Secrets Manager under the Agency and Client path. The database stores only a reference.
- Theme pipeline runs the Shopify CLI inside CodeBuild with a theme access password or an Admin API token.
- Theme listing, preview cleanup, and publish checks use the Admin GraphQL API.
- The app template in Phase 3 starts from Shopify's React Router app template.

### Email

- Amazon SES with a verified sending domain, a configuration set for bounce and complaint tracking, and React Email for templates.

## Delivery infrastructure

Shared hosting: the platform and every Agency's apps run in one platform-owned AWS account, as locked in [alignment.md](alignment.md).

### Accounts

| Account | Holds | Runs workloads |
| --- | --- | --- |
| Management | AWS Organizations, consolidated billing, IAM Identity Center, organization CloudTrail, service control policies | No |
| Hosting | The platform and every Agency's hosted apps, databases, secrets, images, and logs | Yes |
| Sandbox (recommended) | The platform team's experiments and development environment | Yes, never for paying Clients |

- Staff sign in through IAM Identity Center. No IAM users with long-lived keys.
- Service control policies on the hosting account deny leaving the organization, disabling CloudTrail, deleting backup vaults, and using regions other than the chosen one.
- AWS Backup protects RDS and the platform's data, with a copy to a second region.

### Base infrastructure

- Terraform builds the base in the hosting account: VPC, the two EKS clusters, Karpenter node pools, RDS for the platform, shared RDS instances for hosted apps, ElastiCache, OpenSearch, ECR policies, IAM roles, Route 53 zones, ACM certificates, KMS keys, CodeBuild service roles, shared ingress, and budgets.
- Terraform state in S3 with native lockfile locking, one state per component.
- Terraform runs from GitHub Actions with OIDC into AWS. No long-lived AWS keys.

### Kubernetes

- EKS clusters in the hosting account:
  - **Platform cluster:** the product itself (web, API, workers, embedding service, platform Argo CD).
  - **Hosting cluster, one per cell:** Agencies' apps, the hosted Argo CD, Crossplane, and Claude implement jobs. Launch starts with one cell. See Cells below.
- Karpenter node pools on the hosting cluster:
  - `production`: live apps only, on-demand instances.
  - `nonproduction`: previews and staging, Spot instances where possible.
  - `jobs`: Claude implement jobs and other short-lived work, Spot instances, isolated from app pods.
  - `dedicated-<agency>`: optional, for Agencies that buy dedicated capacity.
- Add-ons installed by Argo CD: AWS Load Balancer Controller, Envoy Gateway, cert-manager, ExternalDNS, External Secrets Operator, Kyverno, KEDA, Fluent Bit, metrics-server, OpenCost, and the OpenTelemetry Collector.
- Each app project gets a namespace per environment, named `<agency>-<project>-<env>`, with a default-deny network policy, a ResourceQuota and LimitRange from the hosting tier, and a PriorityClass that puts production above non-production.
- Kyverno policies restrict what an Agency's manifests may create: no cluster-scoped resources, no privileged pods, no host networking, images only from that project's ECR repository, required labels, and a node pool that matches the environment.
- Shared ingress: a Network Load Balancer per cell in front of Envoy Gateway running in the cluster. Envoy Gateway routes by host name to each app and scales as pods. cert-manager issues TLS certificates for platform subdomains and custom domains, so there is no per-load-balancer rule or certificate limit. AWS WAF and per-host rate limits sit in front through CloudFront.
- VPC networking: large subnets for pods and VPC CNI prefix delegation, so IP addresses do not run out as pods scale.

### Scaling

| Layer | Scales by | Limit managed by |
| --- | --- | --- |
| App pods | Horizontal Pod Autoscaler, or KEDA for queue-driven apps, between the tier's minimum and maximum replicas | Tier maximum and the Agency spend cap |
| Nodes | Karpenter | EC2 vCPU quota, alarmed at 70% |
| Ingress | More Envoy Gateway pods behind the cell's Network Load Balancer | One load balancer per cell |
| Database connections | RDS Proxy pooling per shared instance | Per-user connection limit on each app database |
| Database load | A fleet of shared RDS instances per cell. A placement service puts each new app database on the least-loaded instance. A new instance is added when the fleet averages 60% CPU or storage. Busy databases move to a dedicated instance | RDS instance quota, alarmed at 70% |
| Logs | More OpenSearch data nodes | Ingest volume per Agency, limited in Fluent Bit |
| Builds | CodeBuild concurrency | Per-Agency concurrency in the pipeline queue |
| Platform | More cells | Account quotas, raised ahead of need |

### Cells

- A cell is one hosting cluster, its Network Load Balancer and Envoy Gateway, its Karpenter node pools, and its fleet of shared RDS instances with RDS Proxy.
- Each Agency is placed in one cell when its first app is created. All of that Agency's apps stay in that cell.
- A new cell opens when the current cell reaches about 70% of any of: nodes, pods, RDS instances, or OpenSearch ingest.
- Cells are built from the same Terraform module and the same Argo CD bootstrap, so a cell is a parameter, not a new design.
- The platform cluster is not part of any cell and serves every cell.
- All cells live in the shared hosting account. A cell can later move to another account as one unit if the account's quotas are ever outgrown.

### Spend caps

- The platform tracks each Agency's hosting spend for the month from `usage_records`, updated hourly.
- At 50%, 80%, and 100% of the cap, the Owner gets an email and an in-app alert.
- At 100%, a Kyverno policy and an HPA update pin every app's maximum replicas to its current replicas, and Karpenter does not add nodes for that Agency's dedicated pools. Running pods keep serving. Nothing is scaled down or shut off.
- Raising the cap restores each app's tier maximum.
- Stripe billing thresholds charge the card when an Agency's unbilled usage crosses a set amount.

### Isolation inside one account

- **Workload identity.** EKS Pod Identity attaches session tags for the cluster, namespace, and service account. A small set of IAM roles use attribute-based access control: a pod can read only Secrets Manager entries, S3 prefixes, and KMS keys whose `agency` and `project` tags match its own namespace tags. This avoids one IAM role per project, which would run into the account's IAM role quota.
- **Secrets.** Secrets Manager names follow `/<agency>/<client>/<project>/<env>/...`, tagged with the same values. External Secrets Operator syncs them into the namespace.
- **Databases.** Each app environment gets its own database and database user on a shared RDS instance, with a connection limit on that user. RDS Proxy fronts shared instances.
- **Images.** One ECR repository per project, with a repository policy that allows push only from that project's CodeBuild role.
- **Logs.** One OpenSearch domain. Each Agency's documents carry its id, and document-level security restricts every query to one Agency.
- **Encryption.** One KMS key per Agency for its secrets and log archives.
- **Network.** Default-deny between namespaces. Hosted apps reach the internet through shared NAT, and never reach the platform cluster or the platform database.

### Account-level quotas to raise before launch

A single account shares regional quotas across every Agency. Request increases for these before the first paying Agency, and alarm on use above 70%:

- EC2 On-Demand and Spot vCPUs.
- RDS DB instances, and storage per instance.
- ACM certificates, for custom domains.
- Route 53 records per hosted zone.
- CodeBuild concurrent builds.
- Network Load Balancers, one per cell.
- RDS Proxies, one per shared RDS instance.
- IAM roles, as a precaution even with tag-based access.
- Elastic IPs and NAT gateway bandwidth.

API rate limits are also shared across the account. The pipeline and provisioning queues limit concurrency per Agency so one Agency's burst does not throttle the others.

### Argo CD

- A platform Argo CD manages the platform cluster.
- A hosted Argo CD manages the hosting cluster, with one Argo CD project per Agency that restricts source repositories and destination namespaces.
- Deploy from Git is a commit to the Agency's GitOps repository. Deploy from the UI writes the same commit through the GitHub App.
- Production applications use manual sync, triggered only after the approval step in the workflow.

### Tenant builds

- One CodeBuild project per app repository, created in Phase 2 by the platform and in Phase 3 by provisioning.
- Each CodeBuild project assumes a role that can push only to its project's ECR repository and read only its project's build secrets.
- Images are tagged with the commit SHA. ECR scan on push is enabled, and lifecycle rules remove untagged images.
- Theme builds use a separate CodeBuild image with the Shopify CLI and no Docker.

### Per-project infrastructure

- Crossplane runs on the hosting cluster with the AWS provider.
- A Crossplane composition per template defines the project's resources: ECR repository, database and user on a shared RDS instance, Secrets Manager entries, Route 53 record, CodeBuild project, ingress route, and namespace settings from the hosting tier.
- Provisioning in Phase 3 is a commit of a composite resource claim to the Agency's GitOps repository. Argo CD applies it and Crossplane creates the resources. The provisioning workflow reads Crossplane's conditions to show per-resource status.
- Hosted app databases are separate databases on shared RDS instances, one shared pool for production and one for non-production. A dedicated instance is a hosting-tier option. Hosted app databases are never in the platform's own database.
- Every resource carries `agency`, `client`, and `project` tags for cost attribution.

### Hosting economics

- **Metering.** OpenCost reports CPU, memory, and storage cost per namespace. A daily job maps namespaces to Agency, Client, and Project and writes `usage_records`. RDS, OpenSearch, and bandwidth are apportioned by database size, log volume, and request counts.
- **Billing.** Hosting tiers are Stripe subscription items per app environment. Usage above the tier is reported to Stripe meters.
- **Margin.** The AWS Cost and Usage Report, with split cost allocation data for EKS, is loaded daily. The operator console shows AWS cost against revenue per Agency and per hosting tier.
- **Packing.** Karpenter consolidation removes underused nodes. Non-production uses Spot instances, and idle previews scale to zero after a time limit set by the tier.
- **Protection.** Production pods get guaranteed resources. Non-production pods can be evicted first under pressure.

### Logs and observability

- Fluent Bit ships container logs from the hosting cluster to Amazon OpenSearch Service. CodeBuild logs go through CloudWatch Logs to OpenSearch.
- Each Agency's log documents carry its id, and document-level security restricts every query to one Agency. The product's log view queries through the API, never directly from the browser.
- The platform itself is instrumented with OpenTelemetry: traces and metrics to Amazon Managed Prometheus and Grafana, application errors to Sentry, and structured logs to OpenSearch.
- Log retention follows the hosting tier. Older logs are archived to S3 in the hosting account, encrypted with the Agency's KMS key.

## AI

### Embedding service

A Python service owns all chunking, embedding, and reranking. NestJS owns permissions and all reads and writes to PostgreSQL. The Python service never decides who can see what.

- **Runtime.** Python 3.12 or later, managed with `uv`. FastAPI for synchronous endpoints, the BullMQ Python client for queued work, Pydantic for request and job schemas.
- **Indexing.** When a source record changes, NestJS enqueues an `embeddings` job with the record's text, Agency, Client, Project, source id and version, and verification state. The Python worker chunks the text, embeds the chunks, and returns them through a result queue. A NestJS worker writes the chunks and vectors into the Agency's partition.
- **Query.** NestJS calls `POST /embed-query` on the Python service with the search text, receives a vector, and runs the filtered hybrid query in PostgreSQL itself. An optional `POST /rerank` reorders the top results.
- **Models.** The model sits behind an interface in the service. Every vector stores its model id and version. Changing the model triggers a background re-embed per Agency partition, and search uses the old vectors until the new ones are complete.
- **Hosting.** Runs on the platform EKS cluster with no public endpoint. Karpenter adds GPU nodes for bulk re-embedding if the chosen model needs them.
- **Isolation.** The service is stateless. It holds no database credentials and keeps no tenant text after a job finishes. Requests come only from the API and workers over the cluster network, with service-to-service authentication.

### Claude

- Claude through the Claude API with tool use for drafts, proposals, and triage.
- The implement skill runs the Claude Agent SDK inside an isolated container job on the hosting cluster's `jobs` node pool, with a short-lived token scoped to one repository branch, no network access to platform internals, and no secrets.
- Skills live in `skills/` as versioned folders. A skill version is recorded on every agent run.
- Every model call writes token usage to `usage_records` on the Agency.

## Platform delivery

- GitHub Actions builds, tests, and publishes the platform's own images to ECR, and runs Terraform plans on pull requests.
- The platform's own deployments go through the platform Argo CD with the same GitOps rules as Agency apps.
- Environments: local, development, and production. Staging is added before the first paying Agency.

## Local development

- Docker Compose for PostgreSQL with pgvector, Redis, and a local SES-compatible mail catcher.
- `pnpm dev` starts web, api, and worker. `uv run` starts the embedding service.
- A webhook tunnel forwards GitHub and Stripe webhooks to the local API.
- Testcontainers starts real PostgreSQL in integration tests, including the cross-Agency isolation checks from the Phase 1 acceptance list.

## Testing

| Level | Tool | Covers |
| --- | --- | --- |
| Unit | Vitest, pytest | Policy rules, domain logic, chunking |
| Integration | Vitest with Testcontainers | Repositories, row-level security, workflow steps, webhook idempotency |
| End to end | Playwright | Sign-up through discovery, conversion, and pull-request link |
| Isolation | Vitest suite run on every pull request | Every Phase 1 isolation acceptance check |
| Infrastructure | `terraform validate`, `tflint`, Kyverno CLI tests | Base infrastructure and admission policies |

## Still open

- Claude provider: Claude API directly from Anthropic, or Claude on Amazon Bedrock. Working assumption: Claude API directly.
- Embedding model inside the Python service: a self-hosted open model or a hosted embedding API. Working assumption: a self-hosted open model at 1024 dimensions, stored as `halfvec`.
- Redis engine: ElastiCache for Valkey or for Redis OSS. Either works with BullMQ.
- AWS region for the hosting account.
- Hosting tier sizes and prices.
