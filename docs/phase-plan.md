# Phase document plan

Status: six phases planned. Only Phase 1 is specified.
Parent: [alignment.md](alignment.md). Flows: [phase-flows.md](phase-flows.md) and [capability-flow.md](capability-flow.md).

Each phase is one document, written in full when the previous phase's exit criterion is accepted. Until then this file is the scope boundary so later work does not leak backward.

Every phase document uses the same sections:

1. Purpose and exit criterion
2. Users and roles affected
3. In scope and out of scope
4. Domain model added or changed
5. Workflows
6. Permissions, audit, and isolation
7. Acceptance checks
8. Working assumptions
9. Handoff to the next phase

Capability tags C1–C12 refer to the list in [capability-flow.md](capability-flow.md).

## Phase 1 — Foundation

Document: [phase-1-foundation.md](phase-1-foundation.md). Status: specified.
Capabilities: C1 GitHub connection, C5 discovery with KPIs, C8 Solution Consultants prepare stories.

An Agency signs up, adds Clients and members, runs a Shopify discovery, accepts the outcome, and converts requirements into a backlog. Solution Consultants prepare stories and acceptance criteria. Stories link to architecture decisions and to GitHub pull requests. Plans enforce seat and Client caps. Platform support is a request queue.

GitHub is read-only in Phase 1. Write permissions arrive with the phase that needs them.

## Phase 2 — Build and deploy

Document: `docs/phase-2-build-and-deploy.md`. Status: planned, not specified.
Capabilities: C2, C3, C4, C6, C9, C10.

Purpose: take an existing theme repository or app repository from pull request to production on the platform.

Exit criterion: for a theme project, a pull request produces an unpublished preview theme on the Client's store, and an approved merge publishes to the live theme. For an app project, a pull request runs CodeBuild with the repository's `buildspec.yml`, builds the `Dockerfile`, pushes to ECR, and Argo CD deploys to a non-production environment on EKS. An approved promotion reaches production. Each deployment is a record on the project. Build and runtime logs are viewable in OpenSearch for that project only. Build minutes and hosted compute are metered on the Agency.

In scope when that document is written:

- Shopify store connection per Client: store domain, store role (development, staging, live), and theme access credentials kept in Secrets Manager.
- Project delivery type set to theme or app.
- Environments per project: preview, staging, production.
- Theme pipeline: on pull request, push an unpublished theme named for the pull request, post the preview link to the pull request and the story, and delete it when the pull request closes. Shopify limits the number of themes in a store, so cleanup is required.
- Theme release: after merge and approval, push to the live theme. Rollback publishes the previous theme version.
- App pipeline: a CodeBuild project per app repository, triggered by GitHub webhook, assuming a role scoped to that project's ECR repository. `docker build` from the repository `Dockerfile`, push a tag tied to the commit, then commit the new tag to the GitOps repository.
- Argo CD application per project environment. Deploy from Git is a merge to the GitOps repository. Deploy from the UI writes the same commit. Rollback selects a previous tag.
- Approval gate for production promotion and live-theme publish.
- Logs: CodeBuild logs and container logs shipped to OpenSearch, with an Agency index and a project and environment filter in the UI.
- GitHub App gains commit status or check, and pull-request comment permissions.
- Hosting tiers per app environment (CPU and memory, replicas, database size, storage, log retention, bandwidth), enforced as namespace quotas, billed as Stripe subscription items, with overage on Stripe meters.
- Cost per Agency from OpenCost and the AWS Cost and Usage Report, shown against revenue in the operator console.
- Horizontal autoscaling between each tier's minimum and maximum replicas, through the cell's Envoy Gateway and RDS Proxy.
- Monthly hosting spend cap per Agency, alerts at 50%, 80%, and 100%, and scale-up stopped at the cap without shutting anything down.
- Stripe billing thresholds so usage is charged before month end.
- One cell at launch, built from the reusable cell module.

Out of scope: creating new repositories or infrastructure (Phase 3), Claude skills (Phase 4), alerting and incidents (Phase 5).

Domain to add: Shopify Store, Environment, Pipeline, Build, Image, Preview Theme, Deployment, Release Approval, Log Stream.

Handoff to Phase 3: a proven pipeline exists for both delivery types, so templates only need to produce repositories that already fit it.

## Phase 3 — Provisioning

Document: `docs/phase-3-provisioning.md`. Status: planned, not specified.
Capability: C7.

Purpose: start a new Shopify theme or app project from GitHub templates with everything it needs created by the platform.

Exit criterion: choosing the app template creates a repository in the Agency's GitHub organization with a `Dockerfile`, `buildspec.yml`, and deployment manifests, then creates the ECR repository, EKS namespace and workload, RDS database, Secrets Manager entries, app URL with DNS and TLS, Argo CD application, and log routing. The first build deploys to staging and the URL responds. Choosing the theme template creates a repository and wires the preview pipeline to the Client's store. Every resource is tagged with Agency, Client, and Project and appears on the project's resource list.

In scope when that document is written:

- Versioned templates for a Shopify theme and a Shopify app.
- A provisioning run with per-resource status, safe retry, and resume after failure. Provisioning commits a Crossplane claim to the Agency's GitOps repository, Argo CD applies it, and the run reads Crossplane's conditions for status. See [tech-stack.md](tech-stack.md).
- Secrets delivered to pods from Secrets Manager. Database credentials are never shown in the UI, logs, or AI context.
- Deprovisioning on project archive, with approval and a database snapshot first.
- GitHub App gains repository creation in the Agency's organization.
- Quotas for apps, environments, and database size per plan.
- Database placement: each new app database goes on the least-loaded shared RDS instance in the Agency's cell, and a new instance is added when the fleet passes its threshold.
- Cell placement: an Agency is assigned a cell when its first app is provisioned. Opening a new cell is an operator action from the same Terraform module.

Open for that document: whether registering the Shopify app in the Partner Dashboard can be automated or stays a guided manual step.

Out of scope: arbitrary infrastructure outside the templates, customer-supplied Terraform, and any AWS account other than the shared hosting account.

Domain to add: Template, Provisioning Run, Provisioned Resource, App Domain.

Handoff to Phase 4: every project has a repository, a pipeline, and environments the platform controls, so Claude-produced pull requests can be previewed and tested the same way as human work.

## Phase 4 — AI workflow

Document: `docs/phase-4-ai-workflow.md`. Status: planned, not specified.
Capability: C11, C12, plus the drafting workflows from the original plan.

Purpose: remove repetitive work while a person still accepts anything that ships, talks to an external system, or is marked ready. Unanswered Teams questions create `proposed` stories automatically.

Exit criterion: on a real project, Claude can research prior implementations, write a plan for a story that a person approves, implement it on a branch and open a pull request that runs the Phase 2 pipeline, and document the implementation after deployment. A mapped Teams meeting with unanswered questions creates `proposed` stories on that project. Other meeting actions, story drafts, pull-request summaries, and CI failure explanations arrive as proposals that cite their sources. Nothing from another Client appears in any proposal or story.

In scope when that document is written:

- Claude skills, versioned:
  - Research: prior implementations, verified knowledge, decisions, and the repository.
  - Plan: a written plan attached to the story, approved before implementation starts.
  - Implement: a branch and pull request from the approved plan, through the same preview and build pipeline as human work.
  - Document: an implementation note linked to the story, pull request, and deployment, starting in proposed state.
- Action tiers: read, draft, execute after approval. Restricted actions stay unavailable: merge, production promotion, live-theme publish, infrastructure change, secret access, external messages.
- Review queue for proposals, with reasons kept on rejection.
- Context assembly applies Agency id and Client assignment before retrieval. Repository content, transcripts, and logs are treated as data, not instructions.
- Semantic search over knowledge, decisions, and prior resolutions, following the knowledge rules in the alignment:
  - Chunks and embeddings in PostgreSQL with pgvector, derived from source records and rebuilt by a background job when the source or the embedding model changes.
  - Hybrid retrieval: PostgreSQL full-text plus vector similarity, after Agency, Client, and verification-state filters.
  - The embeddings table is partitioned by Agency so each Agency's search uses its own index, and a small Agency is not starved by a large shared index. pgvector iterative index scans are the fallback for filters inside an Agency.
  - Row-level security on the embeddings and source tables as a second guard on the Agency boundary.
  - Platform knowledge base: operator-authored Shopify knowledge with its own editor, review flow, and embeddings, searchable by every Agency and labelled as platform content.
  - Sizing for planning: about 100,000 chunks per Agency, about 10 million at 100 Agencies. If retrieval outgrows PostgreSQL, embeddings move to OpenSearch vector search, which the platform already runs, without changing the source records.
- Microsoft Teams connection (C12): Graph transcript webhooks, open questions created as `proposed` stories on the mapped project. Plan: [teams-integration.md](teams-integration.md).
- Meeting transcript to proposed decisions, actions, risks, and questions, with duplicate detection. Unanswered questions become backlog stories automatically; they are not marked ready.
- Token cost on the usage ledger.

Out of scope: live merchant chat, predictive risk, unattended merges or deploys.

Domain to add: Skill, Skill Version, Agent Run, Tool Invocation, Plan, Proposal, Approval, Knowledge Chunk, Embedding, Platform Knowledge Article, Teams Connection, Meeting Transcript, Meeting Question, Implementation Note.

Handoff to Phase 5: implementation notes and verified knowledge exist and are retrievable, so support triage can cite them.

## Phase 5 — Support and operations

Document: `docs/phase-5-support-and-operations.md`. Status: planned, not specified.

Purpose: connect an Agency's post-launch merchant support to the same project thread. Platform hosting support stays a separate operator queue.

Exit criterion: a merchant report becomes a conversation, then an incident or bug, then a story, then a pull request and deployment from Phase 2, then a verified resolution that later search can cite. The incident carries OpenSearch log evidence and the deployment that preceded it. Another Agency cannot open the conversation.

In scope when that document is written:

- Live chat, agent queue, assignment, human handover.
- AI triage as a Phase 4 proposal: severity, suggested known fix, draft reply. Sending requires approval.
- SLA policy per Client or project.
- Alerts from hosted apps and log patterns that open an incident.
- Incident linked to deployment, logs, story, and fix.
- Resolution record with knowledge states: proposed, reviewed, verified, stale, superseded.
- Retention, redaction, and consent for customer messages and logs.

Out of scope: ranking individual engineers, unattended customer replies.

Domain to add: Support Conversation, Message, Queue Assignment, Incident, Alert, SLA Policy, Resolution Record.

Handoff to Phase 6: deployments, incidents, and recovery times exist as records, so DORA and risk measures come from evidence.

## Phase 6 — Intelligence and autonomy

Document: `docs/phase-6-intelligence-and-autonomy.md`. Status: planned, not specified.

Purpose: explain delivery risk from stored records, then allow a short list of actions to run without a person only where a policy and an evaluation say it is safe.

Exit criterion: an Agency can see blocked work, milestone risk, release readiness, and hosted cost per project, with evidence under each conclusion. At least one autonomous workflow runs only after its evaluation passes, its policy names the allowed action, and every run is attributable.

In scope when that document is written:

- The five DORA metrics from Phase 2 deployments and Phase 5 incidents, plus flow, quality, support, and AI acceptance measures at team and system level.
- Explainable rules first, a predictive model only after the history is reliable.
- No ranking of individuals.
- Agent evaluation and cost reports per Agency, project, and skill.
- Event-driven automation from pull requests, builds, deployments, and incidents.
- An allowlist of autonomous actions, with budgets and fallback to the Phase 4 approval path.

Out of scope: a proprietary coding model, cross-Agency benchmarks that expose another tenant's numbers.

## Writing order

1. Phase 1 is the current document.
2. Implement and accept the Phase 1 exit criterion.
3. Write the next phase document against what actually shipped.
4. Repeat through Phase 6.

If a later idea changes a locked rule in [alignment.md](alignment.md), change the alignment first and then the phase documents.
