# Alignment

Working product: Shopify-first engineering and delivery platform.
Status: locked for planning. Phase documents must follow these decisions.
Revised: 20 October 2026.

This file records the product decisions already made. Anything listed under "Still open" is not decided, and a phase document that needs it must state a working assumption.

## Product

The platform is a delivery control plane for Shopify work. It carries one thread from presales through post-launch learning: the business goal, the requirement, the architecture decision, the story, the code, the build, the deployment, what happened in production, and the verified fix.

The platform also delivers. It builds and deploys Shopify themes and Shopify apps, and it hosts those apps on AWS infrastructure the platform owns and operates. An Agency never needs its own AWS account.

Hosting is a revenue line, sold as shared hosting. Every Agency's apps run in one platform-owned AWS account, on shared clusters, shared database servers, and a shared log store. Margin comes from packing many apps onto shared capacity and charging for plan tiers and usage.

The buyer is an agency, or a brand that uses the product as its own agency. The product is commercial multi-tenant software. Billing, isolation, metering of hosted infrastructure, and a support path are part of the foundation.

AI operates on project context through explicit, permissioned tools and versioned Claude skills. A general chat over unscoped data is outside the product.

## Locked model

```
Platform → Agency → Client → Project
```

| Boundary | Meaning | Rule |
| --- | --- | --- |
| Platform | The operator of this product | Owns the single AWS hosting account and everything in it: EKS, Argo CD, ECR, RDS, Secrets Manager, and OpenSearch. Runs billing and platform support. Does not read project content by default. |
| Agency | The paying tenant | Isolation and billing boundary. Hosted resources, logs, secrets, embeddings, search, and AI context stay inside it. |
| Client | A brand served by that Agency | Delivery boundary. Owns the connected Shopify stores. Members see a Client only when assigned, except Owner and Admin. |
| Project | One delivery engagement | Holds discovery, decisions, backlog, repositories, environments, deployments, and knowledge. Is a theme project or an app project once delivery starts. |

A brand that uses the product with no outside agency is still an Agency. Create the Agency in that brand's name, then a Client (often the same name), then projects. There is no second account type, billing identity, or permission model.

People who do the work are members of the Agency. A merchant who only comments inside an agency's project is a guest on someone else's tenant. Guest access is not in the current model.

## Roles

| Role | Purpose |
| --- | --- |
| Owner | Billing, ownership transfer, Agency deletion, and everything an Admin can do. |
| Admin | Members, Client assignment, Clients, projects, integrations. Sees every Client. |
| Delivery Lead | Accountable for the engagement. Accepts discovery and decisions, approves production releases. |
| Solution Consultant | Runs discovery and prepares stories, acceptance criteria, and proposed decisions. Does not deploy. |
| Engineer | Implements stories, opens pull requests, deploys to non-production environments. |

Owner and Admin can open every Client. Delivery Lead, Solution Consultant, and Engineer open a Client only when assigned to it. Every query, search, webhook, pipeline, log view, and AI context applies the Agency id first, then Client assignment.

## Delivery rules

- GitHub repositories live in the Agency's GitHub organization. The platform's GitHub App reads and, from Phase 2, writes to them. Permissions grow by phase and each increase is approved by the Agency on installation.
- Microsoft Teams is an Agency connection for meeting transcripts only (C12). HiggsDEN does not join the live call. After transcription, unanswered questions become `proposed` stories on a mapped project. The app never posts back into Teams. Plan: [teams-integration.md](teams-integration.md).
- Shopify themes and Shopify apps use different pipelines. A theme never goes through Docker, ECR, or Argo CD.
- Theme pipeline: a pull request creates an unpublished preview theme on the Client's store. A merged and approved change is pushed to the live theme.
- App pipeline: AWS CodeBuild runs the repository's `buildspec.yml`, builds the `Dockerfile`, pushes to ECR, updates the image tag in Git, and Argo CD syncs to EKS.
- Git is the deployment source of truth. A deploy started from the UI writes the same Git change a person would.
- Production releases, live-theme publishes, and infrastructure deletion require approval from a Delivery Lead, Admin, or Owner.
- Claude skills may research, plan, implement on a branch, open a pull request, and document. They may not merge, publish a live theme, promote to production, change infrastructure, or read secrets.
- Logs from builds and hosted apps go to Amazon OpenSearch and are viewable only inside the owning Agency and Client.

## Knowledge and learning

Learning is stored as source records in PostgreSQL. Embeddings are a derived search index, never the record of truth.

- Source records: knowledge notes, architecture decisions, implementation notes, and resolution records. Each has an Agency, Client, and Project, a verification state (`proposed`, `reviewed`, `verified`, `stale`, `superseded`), and links to the story, pull request, and deployment it came from.
- Embeddings live in PostgreSQL with pgvector. Each chunk stores Agency id, Client id, Project id, source record and version, verification state, and embedding model version. They are rebuilt when the source changes or the embedding model changes.
- Keyword search uses PostgreSQL full-text search alongside vector similarity.
- Logs stay in OpenSearch and are not embedded in bulk. Only incident summaries and verified resolutions become learning.
- Retrieval filters by Agency, then Client assignment, then verification state, and only then ranks by similarity and keyword match. Results cite their source records. PostgreSQL row-level security enforces the Agency boundary beneath the application.

Two knowledge scopes:

| Scope | Written by | Searchable by | Contents |
| --- | --- | --- | --- |
| Agency knowledge | That Agency's members and its Claude skills | That Agency only, filtered by Client assignment | Everything the Agency learns on its own projects |
| Platform knowledge | The platform operator | Every Agency | Curated Shopify knowledge: platform limits, API and theme changes, common fixes, recommended patterns, template guidance |

Learning never moves from one Agency to another. Platform knowledge is authored by the operator and is not copied, summarized, or derived from any Agency's records. Search results label which scope each result came from.

## Shared hosting

- One AWS account hosts the platform and every Agency's apps. There is no AWS account per Agency, per Client, or per environment.
- A separate AWS Organization management account holds billing, CloudTrail, and guardrail policies only. It runs no workloads. A separate sandbox account for building the platform itself is recommended and never hosts a paying Client.
- Isolation inside the shared account comes from Kubernetes namespaces, network policy, admission policy, tag-based IAM, a database and database user per app, Secrets Manager paths, and Agency-scoped log access. No Agency can reach another Agency's workload, database, secrets, or logs.
- Capacity is shared: apps share nodes, databases share RDS instances, and logs share one OpenSearch domain. Resource quotas, limits, and per-Agency concurrency stop one tenant from starving the others.
- Production and non-production workloads run on separate node pools so previews and staging never take capacity from live apps.
- Every resource is tagged with Agency, Client, and Project. Cost per Agency is computed from those tags and from per-namespace usage so the operator can see revenue against cost for each Agency.
- Dedicated capacity, such as a dedicated database instance or node pool, is sold as a plan option inside the same account.
- Hosted apps scale horizontally. Pods autoscale within the hosting tier's minimum and maximum replicas, and nodes follow.
- Hosting is organised in cells. A cell is one hosting cluster with its gateway, node pools, and a fleet of shared RDS instances behind RDS Proxy. Each Agency is placed in one cell. When a cell nears its limits, a new cell opens for new Agencies. All cells live in the shared hosting account, and a cell can later move to another account as a unit if the account's quotas are ever outgrown.

## Spend limits

- Every Agency has a monthly hosting spend cap. New Agencies start with a lower cap that rises with payment history.
- The Owner is alerted at 50%, 80%, and 100% of the cap.
- At the cap, apps stop scaling up and keep serving at their current capacity. Nothing is shut down. The Owner can raise the cap from the billing screen, and scaling resumes.
- Usage is charged early when it crosses a billing threshold, not only at month end, so unpaid usage stays small.
- Traffic is filtered at the shared entry point, with a web application firewall and rate limits, before it can trigger scaling.

## Commercial rules

- The Agency is the only billable account.
- Revenue has three parts: a workspace plan (seats and Clients), hosting (plan tiers and usage for hosted apps), and metered usage (build minutes, AI tokens).
- A workspace plan sets a seat cap and a Client cap.
- A hosting tier sets the hosted resources per app environment: CPU and memory, replicas, database size, storage, log retention, and bandwidth. Usage above the tier is billed as overage.
- Usage is recorded on the Agency from the first metered action: build minutes, hosted compute, databases, storage, log volume, bandwidth, and AI tokens.
- Subscription states: trialing, active, past_due, canceled.
- `past_due` keeps read access and blocks new creates, new builds, and new deployments. Running hosted apps keep running.
- `canceled` leaves the Owner a billing screen and blocks project work. Hosted resources are retained for a grace period before deprovisioning.

## Support, two different jobs

Platform support is the operator helping an Agency when this product or the hosted infrastructure fails: access, billing, a broken pipeline, an unhealthy cluster. Phase 1 includes a request queue. Because the platform hosts apps, platform support also covers hosting incidents from Phase 2.

Delivery support is the Agency helping its own merchant after launch: live chat, incidents, fixes, and verified knowledge. That is Phase 5.

## Phase sequence

| Phase | Name | Capabilities | Done when |
| --- | --- | --- | --- |
| 1 | Foundation | GitHub connection, discovery with KPIs, stories by Solution Consultants | One Agency turns an accepted discovery into a reviewable backlog with Client isolation, audit, and a link from a story to a pull request. |
| 2 | Build and deploy | AWS CodeBuild with `buildspec.yml`, Docker build, ECR, Argo CD on EKS from Git or UI, Shopify preview themes from pull requests, theme deploy to Shopify, app deploy to AWS, logs in OpenSearch | An existing theme repository and an existing app repository each go from pull request to production through the platform, with approval, deployment records, and scoped logs. |
| 3 | Provisioning | New repository from GitHub templates that creates the app URL, RDS database, EKS workload, Secrets Manager entries, and related infrastructure | A new app project is created from a template and its first build is reachable on its URL, with every resource tagged and metered. |
| 4 | AI workflow | Claude skills for research, plan, implement, and documenting previous implementations, plus reviewable drafts, plus Teams meeting questions to stories | Claude work arrives as reviewed proposals and pull requests through the Phase 2 pipeline, documentation is linked to the story, pull request, and deployment, and unanswered Teams questions land on the mapped project backlog as `proposed` stories. |
| 5 | Support and operations | Merchant support, incidents, verified resolutions | A merchant issue is traceable from report through fix, deployment, and verified resolution, with OpenSearch evidence attached. |
| 6 | Intelligence and autonomy | Risk, DORA metrics, allowlisted autonomous actions | Risk is explained from stored evidence, and only an allowlisted, evaluated action runs without a person. |

Phase 1 is specified in [phase-1-foundation.md](phase-1-foundation.md). Later phases are planned in [phase-plan.md](phase-plan.md). The full flow across all capabilities is in [capability-flow.md](capability-flow.md).

## Technology

The full stack is in [tech-stack.md](tech-stack.md). These choices are locked:

- TypeScript for the product: NestJS API and workers, React web app.
- Python for the embedding service, which does chunking, embedding, and reranking only. NestJS keeps all permission checks and all database reads and writes.
- Better Auth for sign-in, with its organization mapped to the Agency.
- BullMQ on Redis for all background work, with workflow state and approvals stored in PostgreSQL.
- Terraform for the platform's base infrastructure. Crossplane, applied through GitOps, for each project's resources.
- PostgreSQL with pgvector, as in the knowledge rules above.

## Still open

- Hosting tier names, sizes, and prices, and the overage rates.
- AWS region for the hosting account.
- Where the GitOps manifests live. Working assumption: a platform-created GitOps repository per Agency in the Agency's GitHub organization, with cluster admission policy limiting what those manifests may deploy.
- Claude provider: Claude API directly, or Claude on Amazon Bedrock. Working assumption: Claude API directly.
- Embedding model inside the Python embedding service. Working assumption: one self-hosted open model at a time, 1024 dimensions, stored as `halfvec` to halve storage.
- Workspace plan names, prices, trial length, and numeric caps.
- Whether discovery questionnaires stay a fixed Shopify template or become editable per Agency.
