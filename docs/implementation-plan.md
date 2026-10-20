# Implementation plan

Status: planned, 20 October 2026.
Covers all six phases in [phase-plan.md](phase-plan.md). Follows [alignment.md](alignment.md) and [tech-stack.md](tech-stack.md). Phase 1 detail is in [phase-1-foundation.md](phase-1-foundation.md).

Ten tasks, in order. Tasks 1–9 build the product. Task 10 is the end-to-end suite in Playwright on Chromium that proves every phase's exit criterion.

| Task | Name | Phase | Depends on |
| --- | --- | --- | --- |
| 1 | Monorepo, local environment, and CI | 1 | Nothing |
| 2 | Tenancy, sign-in, roles, billing, support, audit | 1 | 1 |
| 3 | Discovery, decisions, backlog, knowledge, GitHub read-only | 1 | 2 |
| 4 | AWS hosting account, platform cluster, and first cell | 2 | 1 |
| 5 | Theme and app pipelines, approvals, deployments, logs | 2 | 3, 4 |
| 6 | Hosting tiers, autoscaling, metering, spend caps | 2 | 5 |
| 7 | Templates and provisioning | 3 | 6 |
| 8 | Knowledge retrieval, embedding service, Claude skills | 4 | 5, 7 |
| 9 | Merchant support, incidents, delivery intelligence | 5, 6 | 8 |
| 10 | End-to-end tests with Playwright and Chromium | All | 1–9 |

Task 4 can run alongside tasks 2 and 3 because it only needs the repository from task 1.

Every task ships with its own unit and integration tests (Vitest, pytest, Testcontainers). Task 10 is the browser-level proof across the whole product.

---

## Task 1 — Monorepo, local environment, and CI

Phase 1. Foundation for every later task.

**Build**

- pnpm workspace with Turborepo: `apps/web`, `apps/api`, `apps/worker`, `apps/embedding-service`, `packages/db`, `packages/contracts`, `packages/policy`, `packages/ui`, `infra/`, `templates/`, `skills/`, as laid out in [tech-stack.md](tech-stack.md).
- `apps/web`: React, Vite, TanStack Router and Query, Tailwind CSS, shadcn/ui, with an empty authenticated shell.
- `apps/api`: NestJS on Fastify with health check, OpenAPI generation, request-scoped tenant context, and structured logging.
- `apps/worker`: NestJS application context with BullMQ, one example queue, and dead-letter handling.
- `apps/embedding-service`: FastAPI skeleton managed with `uv`, with a health check. No models yet.
- `packages/db`: Drizzle setup, drizzle-kit migrations, a helper that sets `app.agency_id` on each transaction, and a template for row-level security policies.
- `packages/db` also holds `workflow_runs`, `workflow_steps`, and the transactional outbox table used by every workflow from task 5 on.
- Docker Compose: PostgreSQL 16 with pgvector, Redis, and a mail catcher.
- GitHub Actions: install, lint, typecheck, unit and integration tests, build, on every pull request.
- OpenTelemetry and Sentry wiring for api and worker.

**Done when**

- `pnpm dev` starts web, api, and worker against Docker Compose. `uv run` starts the embedding service.
- A migration creates a sample tenant table with row-level security, and an integration test proves a query with Agency A's setting cannot read Agency B's row.
- CI passes on a clean pull request.

---

## Task 2 — Tenancy, sign-in, roles, billing, support, audit

Phase 1. Sections 2, 5, 7, 8, and 11 of [phase-1-foundation.md](phase-1-foundation.md).

**Build**

- Better Auth with email and password, GitHub, and Google sign-in. Its organization is the Agency.
- Tables: Agency, Membership, Client, Client Assignment, Project, Plan, Usage Record, Audit Event, Support Request, Support Reply. Every tenant table has `agency_id` and row-level security.
- Five roles and the Phase 1 permission table as functions in `packages/policy`, used by NestJS guards and by workers.
- Sign-up creates the Agency, the Owner membership, and a trial. Empty states guide the Owner to create the first Client and project.
- Members: invite, role change, removal, Client assignment. Seat cap counts active members and pending invites.
- Clients and projects, with the Client cap and unique project keys.
- Stripe Billing in test mode: plan, trial, subscription webhook, and the `trialing`, `active`, `past_due`, `canceled` behaviour from section 8.
- Audit events for every action listed in section 7, and the project activity feed.
- Support requests from members and replies from the operator console. The operator console lists Agencies, plans, and requests only.
- Operator flag on users and a separate route tree and guard for the console.

**Done when**

- Phase 1 acceptance checks 2, 7, 8, and 9 pass as integration tests.
- A Delivery Lead, Solution Consultant, or Engineer with no assignment sees an empty workspace.
- Changing an id in any API request to another Agency's record returns not found.

---

## Task 3 — Discovery, decisions, backlog, knowledge, GitHub read-only

Phase 1. Sections 5, 6, 9, and 10 of [phase-1-foundation.md](phase-1-foundation.md). Capabilities C1, C5, C8.

**Build**

- Discovery template, versioned in code: the eight sections and the KPI catalog.
- Discovery Session with `draft`, `in_review`, `accepted`. Accepting freezes the version, and later edits open a new draft.
- KPI, Constraint, Risk, Requirement, and Recommendation records.
- Conversion of accepted requirements into `proposed` stories, with epic selection and audit.
- Architecture Decisions: `proposed`, `accepted`, `superseded`, linked to requirements and stories.
- Backlog: Epic, Story, Acceptance Criterion, Task, Dependency, Milestone. A story moves to `ready` only with a description and at least one acceptance criterion.
- Knowledge Notes with verification state.
- Keyword search with PostgreSQL full-text across notes, decisions, requirements, and stories, filtered by Agency and Client assignment.
- GitHub App, development registration, read-only: installation flow, repository attach to one project, pull-request webhook with signature check, delivery-id idempotency, and story-key linking. Manual pull-request linking from the story.
- Traceability views: from a KPI to a requirement, decision, story, and pull request, and back.

**Done when**

- All ten Phase 1 acceptance checks pass as integration tests.
- The Phase 1 exit criterion holds with two Agencies seeded side by side.

---

## Task 4 — AWS hosting account, platform cluster, and first cell

Phase 2 infrastructure. The "Delivery infrastructure" sections of [tech-stack.md](tech-stack.md).

**Build**

- AWS Organization with the management account, the shared hosting account, and the sandbox account. IAM Identity Center for staff. Service control policies on the hosting account.
- Terraform in `infra/terraform`, state in S3 with lockfile locking, run from GitHub Actions through OIDC.
- Hosting account base: VPC with large pod subnets, platform RDS with pgvector, ElastiCache, OpenSearch domain, KMS keys, Route 53 zones, SES domain, AWS Backup with a cross-region copy, budgets, and quota alarms at 70%.
- Platform EKS cluster with platform Argo CD. The api, worker, web, and embedding service deploy to it from the platform's own GitOps folder.
- A reusable `cell` Terraform module, applied once for cell 1: hosting EKS cluster, Karpenter node pools (`production`, `nonproduction`, `jobs`), VPC CNI prefix delegation, Network Load Balancer, Envoy Gateway, cert-manager, ExternalDNS, External Secrets Operator, Kyverno, KEDA, Fluent Bit, OpenCost, OpenTelemetry Collector, hosted Argo CD, and Crossplane with the AWS provider.
- A shared RDS instance pool for production and one for non-production in cell 1, each behind RDS Proxy.
- CloudFront with AWS WAF in front of the cell's load balancer.
- Kyverno baseline policies: no cluster-scoped resources from Agencies, no privileged pods, no host networking, images only from the project's ECR repository, required labels, node pool by environment.
- Tag-based IAM for workloads through EKS Pod Identity session tags.
- Service quota increase requests from the list in [tech-stack.md](tech-stack.md).

**Done when**

- The product from tasks 2 and 3 runs on the platform cluster at the development domain.
- A sample namespace in cell 1 can read only its own tagged secret, and a Kyverno CLI test suite proves each baseline policy rejects a bad manifest.
- `terraform plan` for the hosting account is clean and a second cell can be planned by changing only module inputs.

---

## Task 5 — Theme and app pipelines, approvals, deployments, logs

Phase 2. Capabilities C2, C3, C4, C6, C9, C10.

**Build**

- Shopify store connection per Client: domain, store role, and theme credentials in Secrets Manager under `/<agency>/<client>/...`. The database keeps only a reference.
- Project delivery type: theme or app, defaulting from the accepted recommendation.
- Environments per project: preview, staging, production.
- GitHub App permission increase: checks or statuses, pull-request comments, contents read. Reinstall flow for existing Agencies.
- Workflow engine on BullMQ using `workflow_runs` and `workflow_steps`: start through the outbox, step execution, retries with backoff, `waiting_for_approval`, resume from a failed step, per-Agency concurrency on the `pipelines` queue.
- Theme pipeline: CodeBuild image with the Shopify CLI. On pull request, push an unpublished theme named for the pull request, post the preview link to the pull request and the story, and delete it when the pull request closes. After merge and approval, push to the live theme. Rollback publishes the previous version.
- App pipeline: one CodeBuild project per app repository with a role that can push only to its ECR repository. `buildspec.yml` runs, `docker build` uses the repository `Dockerfile`, the image is tagged with the commit SHA and pushed to ECR, and the tag is committed to the Agency's GitOps repository.
- Agency GitOps repository creation in the Agency's GitHub organization, and one hosted Argo CD project per Agency.
- Argo CD applications per project environment. Staging syncs automatically. Production syncs manually after approval.
- Deploy from the UI: choose tag and environment, which writes the same GitOps commit.
- Release approval by Delivery Lead, Admin, or Owner, audited.
- Deployment records: environment, version, actor, time, result, linked to the story and pull request.
- Log view: CodeBuild and container logs in OpenSearch, queried through the API with Agency document-level security, filtered by project and environment.

**Done when**

- The Phase 2 exit criterion passes for a sample theme repository on a development store and a sample app repository on cell 1.
- Delivering the same GitHub webhook twice starts one pipeline run.
- An Engineer cannot promote to production, and a Delivery Lead can.
- A log query from Agency A never returns Agency B's lines, tested with seeded log documents.

---

## Task 6 — Hosting tiers, autoscaling, metering, spend caps

Phase 2. The "Shared hosting", "Spend limits", and "Commercial rules" sections of [alignment.md](alignment.md). "Scaling", "Spend caps", and "Hosting economics" in [tech-stack.md](tech-stack.md).

**Build**

- Hosting tier records: CPU and memory, minimum and maximum replicas, database size, storage, log retention, bandwidth, preview idle time.
- Applying a tier writes the namespace ResourceQuota, LimitRange, PriorityClass, and HPA bounds through GitOps.
- Horizontal Pod Autoscaler by default, KEDA for queue-driven apps.
- Idle preview environments scale to zero after the tier's limit.
- Metering: OpenCost per namespace, mapped to Agency, Client, and Project hourly into `usage_records`. RDS, OpenSearch, and bandwidth apportioned by size, volume, and requests. Build minutes from CodeBuild.
- Stripe: hosting tiers as subscription items per app environment, overage on Stripe meters, and billing thresholds.
- Spend cap per Agency, starting lower for new Agencies. Alerts at 50%, 80%, and 100% by email and in app. At 100%, pin maximum replicas to current replicas without scaling anything down. Raising the cap restores tier maximums.
- Operator console: AWS Cost and Usage Report with EKS split cost allocation data loaded daily, cost against revenue per Agency and per tier, cell capacity against the 70% thresholds.

**Done when**

- A load test against a sample app scales pods up to the tier maximum and no further.
- An Agency pushed over its cap stops scaling, keeps serving, and resumes after the cap is raised.
- Usage for a test day matches OpenCost within an agreed tolerance and appears on the Stripe test invoice.

---

## Task 7 — Templates and provisioning

Phase 3. Capability C7.

**Build**

- Theme template and app template repositories in the platform's GitHub organization. The app template starts from Shopify's React Router app template and includes a `Dockerfile`, `buildspec.yml`, and deployment manifests.
- GitHub App permission increase: repository creation and contents write.
- Crossplane compositions per template: ECR repository, database and user on a shared RDS instance, Secrets Manager entries, Route 53 record, CodeBuild project, ingress route, and namespace settings from the tier.
- Provisioning workflow: create the repository from the template, commit the composite claim to the Agency's GitOps repository, wait for Crossplane conditions, report per-resource status, retry or resume failed resources, then run the first build through the task 5 pipeline.
- Database placement on the least-loaded shared instance in the Agency's cell, and an operator alert when the pool passes its threshold.
- Cell placement on an Agency's first app.
- Custom domains for app URLs with cert-manager certificates.
- Deprovisioning on archive: approval, database snapshot, then resource removal.
- Guided manual step for registering the Shopify app in the Partner Dashboard, unless automation is confirmed.

**Done when**

- The Phase 3 exit criterion passes: a new app project from the template is reachable on its staging URL, and every resource is tagged and on the project's resource list.
- A provisioning run interrupted midway resumes without duplicating resources.
- Deprovisioning leaves a snapshot and no running resources.

---

## Task 8 — Knowledge retrieval, embedding service, Claude skills

Phase 4. Capabilities C11 and C12. The "Knowledge and learning" section of [alignment.md](alignment.md) and [teams-integration.md](teams-integration.md).

**Build**

- Embedding service: chunking, an embedding model behind an interface, `POST /embed-query`, `POST /rerank`, and a BullMQ Python worker on the `embeddings` queue. Service-to-service authentication, no database credentials, no retained tenant text.
- `knowledge_chunks` and `embeddings` tables partitioned by Agency, `halfvec` vectors, HNSW index per partition, model version on every row, and a re-embed job.
- Hybrid retrieval in NestJS: Agency, Client assignment, and verification state filters, then full-text and vector ranking, with citations.
- Platform knowledge base: operator editor, review flow, and results labelled as platform content.
- Agent run, tool invocation, proposal, approval, and token usage records.
- Action tiers enforced in the policy package. Restricted actions are not exposed as tools.
- Claude skills in `skills/`, versioned:
  - Research: prior implementations, verified knowledge, decisions, and repository.
  - Plan: a plan attached to the story, approved before implementation.
  - Implement: the Claude Agent SDK in an isolated job on the cell's `jobs` node pool, with a token scoped to one branch and no secrets, opening a pull request that runs the task 5 pipeline.
  - Document: an implementation note linked to story, pull request, and deployment, in `proposed` state.
- Drafting proposals: stories and acceptance criteria, meeting transcript extraction with duplicate detection, pull-request summary, CI failure explanation, status report.
- Microsoft Teams (C12): Agency connection, Graph transcript webhook (dummy until an Entra app exists), classifier for unanswered questions, auto-create `proposed` stories on the mapped project. Database is in place (`0003_teams.sql`: connections, organizers, maps, transcripts, questions, RLS). Remaining: connection page, webhook worker, classifier, Graph adapter. See [teams-integration.md](teams-integration.md).
- Review queue: accept creates normal records through the same rules, reject keeps the reason.

**Done when**

- The Phase 4 exit criterion passes on a sample project.
- An evaluation set proves retrieval never returns another Agency's or an unassigned Client's chunk.
- A prompt-injection fixture in a repository file cannot make a skill call a restricted action.

---

## Task 9 — Merchant support, incidents, delivery intelligence

Phases 5 and 6.

**Build — support and operations**

- Live chat widget for an Agency's merchants, support conversations, messages, agent queue, assignment, and human handover over WebSockets with the Socket.IO Redis adapter.
- AI triage as a proposal: severity, known fix from retrieval, draft reply. Sending requires approval.
- SLA policy per Client or project, with first response and resolution clocks.
- Alerts from hosted app health and OpenSearch log patterns open incidents.
- Incident linked to the preceding deployment, log evidence, story, pull request, and fix deployment.
- Resolution record with symptom, environment, root cause, fix, affected versions, evidence, and verification state, feeding the knowledge index.
- Retention, redaction, and consent settings for messages and logs.

**Build — intelligence and autonomy**

- The five DORA metrics from deployments and incidents, plus flow, quality, support, and AI acceptance measures, at team and system level only.
- Explainable rules for blocked work, milestone risk, and release readiness, each showing its evidence.
- Hosted cost per project in the Agency view.
- Event-driven automation from pull requests, builds, deployments, and incidents.
- An allowlist of autonomous actions, each with a policy, a passing evaluation, a budget, and fallback to the approval path.

**Done when**

- The Phase 5 exit criterion passes: a merchant report traces through incident, story, pull request, deployment, and verified resolution.
- The Phase 6 exit criterion passes with one allowlisted action enabled and audited.
- No report ranks individual people.

---

## Task 10 — End-to-end tests with Playwright and Chromium

All phases. Browser-level proof of every exit criterion and the cross-Agency isolation rules.

**Setup**

- `tests/e2e` workspace package with `@playwright/test`.
- `playwright.config.ts` with a single `chromium` project, `baseURL` from the environment, traces on first retry, screenshots and video on failure, and the HTML reporter.
- Browser install in CI with `pnpm exec playwright install --with-deps chromium`.
- Global setup seeds two Agencies through a test-only seeding API that is disabled outside test environments. Each has Clients, members in all five roles, and Client assignments.
- Saved sign-in state per role and Agency in `tests/e2e/.auth/`, so specs start signed in.
- Fixtures for each role, for a seeded project, and for API helpers that send signed GitHub, Stripe, and Shopify webhooks.

**Two suites**

| Suite | Runs | Against | External services |
| --- | --- | --- | --- |
| `pr` | Every pull request | Docker Compose environment in CI | GitHub, Stripe, Shopify, AWS replaced by local fakes and signed webhook fixtures |
| `nightly` | Nightly and before each release | The development environment on AWS | Real GitHub test organization, Stripe test mode, Shopify development stores, cell 1 |

Specs tagged `@pr` run in both. Specs tagged `@nightly` need real infrastructure.

**Specs**

| File | Proves | Tag |
| --- | --- | --- |
| `phase1/signup-and-setup.spec.ts` | Sign-up, Agency, trial, first Client and project, empty states | `@pr` |
| `phase1/members-and-assignment.spec.ts` | Invites, roles, seat cap, assignment hides unassigned Clients | `@pr` |
| `phase1/discovery-to-backlog.spec.ts` | Template, KPIs, `in_review`, Delivery Lead acceptance, conversion, audit rows | `@pr` |
| `phase1/solution-consultant.spec.ts` | Consultant prepares stories and proposes decisions, cannot accept either | `@pr` |
| `phase1/story-readiness.spec.ts` | `ready` refused without an acceptance criterion | `@pr` |
| `phase1/github-linking.spec.ts` | Pull-request link by story key, duplicate webhook, wrong project key | `@pr` |
| `phase1/billing-states.spec.ts` | Client cap, `past_due` read-only, `canceled` billing-only | `@pr` |
| `phase1/support-queue.spec.ts` | Request, operator reply, operator cannot see stories | `@pr` |
| `isolation/cross-agency.spec.ts` | Agency B cannot open Agency A's records by URL, search, or logs | `@pr` |
| `isolation/cross-client.spec.ts` | An Engineer on one Client cannot reach another Client's project | `@pr` |
| `phase2/theme-preview.spec.ts` | Pull request creates a preview theme link, close deletes it, approval publishes | `@nightly` |
| `phase2/app-deploy.spec.ts` | CodeBuild, ECR, Argo CD staging, approval, production, rollback | `@nightly` |
| `phase2/deploy-from-ui.spec.ts` | UI deploy writes a GitOps commit and syncs | `@nightly` |
| `phase2/release-approval.spec.ts` | Engineer refused, Delivery Lead approves, audit row | `@pr` |
| `phase2/logs.spec.ts` | Log view filters by project and environment, no cross-Agency lines | `@pr` with seeded logs, `@nightly` with real logs |
| `phase2/spend-cap.spec.ts` | Alerts at thresholds, scale-up stopped at cap, resume after raise | `@pr` with simulated usage |
| `phase3/provision-app.spec.ts` | Template to reachable staging URL with resource list | `@nightly` |
| `phase3/provision-resume.spec.ts` | Interrupted run resumes without duplicates | `@nightly` |
| `phase3/deprovision.spec.ts` | Approval, snapshot, removal | `@nightly` |
| `phase4/knowledge-search.spec.ts` | Hybrid search, citations, platform knowledge label, no cross-Client results | `@pr` |
| `phase4/claude-rpi.spec.ts` | Research, plan approval, implement pull request, document note | `@nightly` |
| `phase4/proposal-review.spec.ts` | Accept creates a normal story, reject keeps the reason | `@pr` with a recorded model response |
| `phase5/merchant-chat.spec.ts` | Chat, handover, approved AI reply, SLA clock | `@pr` |
| `phase5/incident-to-resolution.spec.ts` | Incident with deployment and log evidence to verified resolution | `@pr` with seeded deployment |
| `phase6/delivery-intelligence.spec.ts` | DORA and risk views show evidence, no individual ranking | `@pr` with seeded history |
| `phase6/autonomous-action.spec.ts` | Allowlisted action runs and audits, others route to approval | `@pr` |

**Rules for the suite**

- Locators use roles, labels, and test ids. No CSS selectors tied to styling.
- Each spec creates or reuses its own seeded data and cleans up, so specs can run in parallel.
- AI specs in the `pr` suite use recorded model responses. The `nightly` suite uses the real model with a small token budget.
- A failed isolation spec blocks merge, with no retries allowed for that folder.

**CI**

- `e2e-pr` job in GitHub Actions: start Docker Compose, run migrations and seed, start web, api, and worker, run `pnpm exec playwright test --project=chromium --grep @pr`, upload the HTML report and traces.
- `e2e-nightly` workflow on a schedule and before release: run `--grep @nightly` against the development environment, upload artifacts, and open an issue on failure.

**Done when**

- Every spec in the table exists and passes in its suite.
- The `pr` suite runs in under 15 minutes on CI.
- Every phase exit criterion in [phase-plan.md](phase-plan.md) maps to at least one passing spec.
