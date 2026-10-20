# Phase 1 — Foundation

Status: specified.
Parent: [alignment.md](alignment.md).
Plan: [phase-plan.md](phase-plan.md).
Date: 17 October 2026. Revised 20 October 2026: Solution Consultant role, KPI catalog, six-phase handoff.

## 1. Purpose and exit criterion

Phase 1 is the smallest commercial product. An Agency can sign up, isolate its Clients, capture a Shopify discovery, and turn the accepted outcome into a backlog a team can execute. A story points back at the requirement and the architecture decision, and forward at a GitHub pull request.

Exit criterion: one Agency completes this path on one Client project, a second Agency exists at the same time, and no screen, search result, webhook, or export shows the second Agency’s data. The backlog items created from discovery are reviewable records with an author, not an automatic commitment to build.

## 2. Users and roles

| Role | Who | Phase 1 authority |
| --- | --- | --- |
| Platform operator | The company running the product | Subscription state, plan caps, and platform-support requests. No project content. |
| Owner | Creates the Agency | Everything an Admin can do, plus billing, transfer of ownership, and Agency deletion. |
| Admin | Agency operations | Members, Client assignment, Clients, projects, and support requests. Sees every Client. |
| Delivery Lead | Accountable for the engagement | Accepts discovery and decisions, owns milestones, and can do everything a Solution Consultant can on assigned Clients. |
| Solution Consultant | Shapes the work | Runs discovery, converts requirements, prepares stories and acceptance criteria, and proposes decisions on assigned Clients. Cannot accept a discovery or a decision. |
| Engineer | Does the delivery work | Stories, tasks, GitHub links, and knowledge on assigned Clients. Cannot edit discovery or change membership. |

A member has one role in the Agency. Client assignment is separate from role. Owner and Admin are implicitly assigned to every Client. Delivery Lead, Solution Consultant, and Engineer start with no Clients and see an empty workspace until an Admin assigns them.

External guests, merchant logins, and per-project roles wait. See the alignment.

## 3. Scope

### In scope

- Account, Agency, membership, invite, and the five Agency roles.
- Clients, Client assignment, and projects under a Client.
- Shopify discovery session, acceptance, and conversion into epics and stories.
- Architecture decision records linked to requirements and stories.
- Backlog: epic, story, task, status, dependency, acceptance criteria, and project milestones.
- Knowledge notes attached to a project, including decision records, with keyword search inside the member’s Clients.
- GitHub App installed by the Agency, repositories attached to a project, and pull requests linked to stories.
- Audit history for consequential actions.
- Plan, seat cap, Client cap, subscription state, and a usage-ledger table.
- Platform support requests with replies.

### Out of scope

- Shopify store connections, preview themes, builds, ECR, Argo CD, deployments, and logs. Phase 2.
- Creating repositories and provisioning infrastructure. Phase 3.
- Claude skills, model calls, generated drafts, embeddings, and meeting transcripts. Phase 4.
- Live chat, queues, SLAs, incidents, and customer messages. Phase 5.
- Sprints, velocity, forecasting, and DORA dashboards. Phase 6.
- Any GitHub write: branches, commits, pull requests, statuses, merges.
- Guest users and Client-company logins.
- Invoicing usage. The ledger table exists so Phase 2 can meter builds and hosting without a migration of the tenancy model.
- Editable questionnaire builders. Phase 1 ships one Shopify discovery template.

## 4. Product surfaces

- **Sign up.** Create the user, the Agency, and the Owner membership. Start a trial.
- **Clients.** List, create, and assign members. Creating a Client is blocked at the plan cap.
- **Project.** Tabs: Discovery, Decisions, Backlog, Repositories, Knowledge, Activity.
- **Members.** Invite, change role, remove, assign Clients. Invites are blocked at the seat cap.
- **Billing.** Plan, subscription state, seats used, Clients used. Owner can update payment and plan.
- **GitHub.** Install the app, choose repositories, attach a repository to one project.
- **Support.** Agency members submit a platform request. Operators reply from an operator console that lists Agencies, plans, and requests only.
- **Activity.** Audit entries for the project, filtered by what the member can already open.

There is no global search across Agencies. Project search returns knowledge, decisions, requirements, and stories for Clients the member can open.

## 5. Domain model

Agency id is on every tenant row. Client id is on every row that belongs to a Client. Project id is on every row that belongs to a project.

### Tenancy and access

- **User.** Identity. Can belong to more than one Agency.
- **Agency.** Name, slug, billing account id, plan, subscription state.
- **Membership.** User, Agency, role, status (invited, active, removed).
- **Client.** Agency, name, summary. The brand being served.
- **Client Assignment.** Membership and Client. Required for Delivery Lead, Solution Consultant, and Engineer.
- **Project.** Client, name, key, summary, status (active, archived). The key is unique inside the Agency and prefixes story ids (`ACME-12`).

A project cannot be created until a Client exists. Deleting an Agency is an Owner action that removes tenant data according to the retention rule in section 11. Removing a member revokes access immediately and keeps their audit history.

### Discovery

- **Discovery Session.** One current session per project, plus retained versions. Status: `draft`, `in_review`, `accepted`.
- **Discovery Answer.** Session, template question id, answer text.
- **KPI.** Session, catalog metric or custom name, category (`business`, `technical`), unit, baseline, target, measurement source, notes.
- **Constraint.** Session, statement, source.
- **Risk.** Session, statement, impact, mitigation, owner.
- **Requirement.** Session, statement, type (`functional`, `constraint`, `non_functional`), priority, status (`captured`, `accepted`, `rejected`, `converted`).
- **Recommendation.** Session, summary, chosen approach, reasons. Approaches for the template are Shopify theme, custom app, Hydrogen or headless storefront, and hybrid.

Accepting a session freezes that version. Further edits create a new draft version. Accepted requirements are the only ones that can be converted.

### Decisions and backlog

- **Architecture Decision.** Project, title, status (`proposed`, `accepted`, `superseded`), context, decision, consequences. Links to requirements.
- **Epic.** Project, title, outcome, status.
- **Story.** Project, epic (optional), key, title, description, status, estimate (optional), requirement (optional), architecture decision (optional).
- **Acceptance Criterion.** Story, statement, position.
- **Task.** Story, title, done.
- **Dependency.** From story, to story, type `blocks`.
- **Milestone.** Project, name, target date, linked stories.

Story status: `proposed`, `ready`, `in_progress`, `done`, `canceled`.

Conversion from an accepted requirement creates a story in `proposed`, copies the requirement statement into the description, and sets the requirement status to `converted`. The user chooses an existing epic or creates one. Conversion does not set a milestone and does not assign an engineer. One requirement produces one story in Phase 1. Splitting is a manual follow-up.

Superseding a decision requires a new decision that points at the old one. Stories keep their original decision link so history stays readable.

### GitHub

- **GitHub Installation.** Agency, installation id, account login.
- **Repository.** Installation, GitHub repo id, name. Attached to at most one project in Phase 1.
- **Pull Request Link.** Story, repository, pull-request number, url, state, title. Unique on repository plus number.

### Knowledge, audit, billing, support

- **Knowledge Note.** Project, title, body, author, updated time, verification state (`proposed`, `reviewed`, `verified`, `stale`, `superseded`; new notes start `proposed`). Decision records remain the Architecture Decision entity. Notes are the freeform runbooks and research. Phase 1 stores the state and shows it. Phase 4 uses it to filter retrieval.
- **Audit Event.** Agency, actor, client, project, entity type, entity id, action, timestamp, summary of the change. Append-only.
- **Plan.** Code, seat cap, Client cap.
- **Usage Record.** Agency, meter, quantity, source id, timestamp. No rows are required for the Phase 1 exit path. The table is part of the schema.
- **Support Request.** Agency, author, subject, body, status (`open`, `answered`, `closed`).
- **Support Reply.** Request, author (member or operator), body, timestamp.

## 6. Workflows

### 6.1 Open an Agency

1. The user creates an account and an Agency name.
2. The product creates the Agency, the Owner membership, and a trial subscription.
3. The Owner creates the first Client.
4. The Owner creates a project under that Client and sets the project key.

Until the first Client and project exist, discovery and backlog actions are unavailable. The empty state tells the Owner to create them.

### 6.2 Add the team

1. An Owner or Admin invites by email up to the seat cap. Pending invites count toward the cap.
2. They set a role.
3. For a Delivery Lead, Solution Consultant, or Engineer they assign one or more Clients.
4. The invitee joins the Agency and sees only assigned Clients.

Changing a role to Owner or Admin expands access to all Clients. Changing it away from those roles leaves only explicit assignments.

### 6.3 Run discovery

A Solution Consultant or Delivery Lead opens the project discovery template and works through it. Saves are drafts. They mark the session `in_review` when the recommendation and requirements are ready.

The template sections, in order:

1. **Store context.** Shopify plan, markets, current theme or storefront, apps already in use.
2. **Business outcome.** Why this engagement exists, and the KPIs to move, each with a baseline and a target. KPIs are picked from the catalog below or added as custom metrics.
3. **Delivery shape.** Theme change, custom app, Hydrogen or headless, or hybrid, plus the reasons.
4. **Integrations.** ERP, PIM, payments, subscriptions, and other systems the store depends on.
5. **Constraints.** Shopify platform limits, timeline, budget, and compliance limits the team already knows.
6. **Risks.** What can make the launch miss, with impact and mitigation.
7. **Requirements.** Statements a story could implement.
8. **Recommendation.** The chosen shape and the reasons, tied to the answers above.

KPI catalog shipped with the template:

| Category | Metrics |
| --- | --- |
| Business | Conversion rate, average order value, revenue per visitor, checkout completion rate, cart abandonment rate, repeat purchase rate, customer acquisition cost, subscription retention, returns rate |
| Technical | Largest Contentful Paint, Interaction to Next Paint, Cumulative Layout Shift, Lighthouse performance score, storefront error rate, app uptime, API response time p95, theme app extension count, third-party script weight |
| Delivery | Launch date, deployment frequency target, change lead time target, defect escape target |

Phase 1 records baseline and target as entered values with a measurement source. Pulling live values from Shopify analytics or hosted-app telemetry is a later phase.

An Admin or Owner may also edit a draft. An Engineer can read discovery on assigned Clients and cannot change it.

### 6.4 Accept and convert

1. A Delivery Lead, Admin, or Owner moves an `in_review` session to `accepted`.
2. They, or a Solution Consultant on that Client, select accepted requirements and convert them.
3. Each conversion creates a `proposed` story, links the requirement, and writes an audit event with the actor.
4. The backlog shows the new stories as proposed work, not as committed scope.

Rejecting a requirement keeps it on the session with status `rejected` and creates no story.

### 6.5 Record a decision and prepare a story

A Solution Consultant or Delivery Lead writes an architecture decision in `proposed` and links the requirements it resolves. Only a Delivery Lead, Admin, or Owner moves it to `accepted`.

The Solution Consultant prepares each story: description, acceptance criteria, epic, dependencies, and the linked decision. A Solution Consultant or Delivery Lead moves a story to `ready` only when it has a description, at least one acceptance criterion, and either a linked decision or an explicit mark that no decision is required. Phase 1 enforces the description and one acceptance criterion. The decision link is recorded and shown. It does not block `ready`, because some stories are too small to need one.

Engineers move stories across `ready`, `in_progress`, and `done`, add tasks, and add blocking dependencies. Nobody deletes an accepted requirement or an audit event. Stories are canceled, not deleted.

### 6.6 Connect GitHub

1. An Admin installs the GitHub App on the Agency’s GitHub account.
2. They attach a repository to one project.
3. A member links a pull request to a story in the project UI, or the webhook links it when the pull-request title or body contains the story key.
4. The story shows pull-request title, number, url, and open or closed state.

Phase 1 does not create branches, push commits, or merge. Webhook processing stores the GitHub delivery id and ignores duplicates. The handler loads the Agency from the installation id and drops events for repositories that are not attached to a project.

### 6.7 Find prior knowledge

A member searches inside a project. Results include notes, decisions, requirements, and stories for that project. Search text is the title and body. Results the member cannot open are not returned, including when they guess another project’s id.

### 6.8 Ask for platform support

A member submits a request. An operator replies. The request body is whatever the member typed. The product does not attach discovery, code, or knowledge automatically.

## 7. Permissions, audit, and isolation

Enforcement happens in the application boundary that loads tenant data, not only in the screen. Direct object requests check Agency, then Client assignment, then project ownership.

"Assigned" means only on Clients the member is assigned to.

| Action | Owner | Admin | Delivery Lead | Solution Consultant | Engineer |
| --- | --- | --- | --- | --- | --- |
| Manage billing and delete Agency | Yes | No | No | No | No |
| Invite, role, Client assignment | Yes | Yes | No | No | No |
| Create Client and project | Yes | Yes | No | No | No |
| Edit discovery, mark `in_review` | Yes | Yes | Assigned | Assigned | No |
| Accept discovery | Yes | Yes | Assigned | No | No |
| Convert requirements | Yes | Yes | Assigned | Assigned | No |
| Propose decisions | Yes | Yes | Assigned | Assigned | Read |
| Accept or supersede decisions | Yes | Yes | Assigned | No | No |
| Prepare stories and acceptance criteria, move to `ready` | Yes | Yes | Assigned | Assigned | No |
| Work stories: tasks, status after `ready`, dependencies | Yes | Yes | Assigned | Assigned | Assigned |
| Attach repositories | Yes | Yes | No | No | No |
| Link a pull request | Yes | Yes | Assigned | Assigned | Assigned |
| Write knowledge notes | Yes | Yes | Assigned | Assigned | Assigned |
| Submit a support request | Yes | Yes | Yes | Yes | Yes |

Audit these actions: membership invite, role change, removal, Client assignment change, Client create, project create, discovery accept, requirement convert, requirement reject, decision accept or supersede, story create and status change, repository attach, pull-request link, plan change, subscription state change, support request create and close.

An audit row records the actor and the Agency. It is visible on the project activity feed to members who can open that project. Operators do not get this feed.

Isolation acceptance is part of the exit criterion:

- A member of Agency A cannot read Agency B by changing an id.
- An Engineer assigned only to Client A1 cannot read Client A2 inside the same Agency.
- Search, repository attachment, and webhook linking follow the same rules.
- Support requests are visible to that Agency’s members and to operators. They are not visible to other Agencies.

## 8. Billing behavior

- Signup starts a trial. Trial length and caps are configuration, not hard-coded in screens.
- Seat use is active memberships plus pending invites. At the cap, invite is refused with the cap and the current use.
- Client use is non-deleted Clients. At the cap, create is refused the same way.
- `past_due` allows read, search, and support requests. It refuses invites, Client creation, discovery edits, conversions, and new stories.
- `canceled` allows the Owner to open billing only.
- Usage Record is unused by the Phase 1 screens. Schema and write path exist and are covered by a test that inserts a row for the correct Agency.

Prices and plan names are a commercial decision. The product behavior above is the Phase 1 contract.

## 9. GitHub contract

- One GitHub App for the product.
- Installation is per Agency, with the permissions required to read repository metadata and pull requests. No write permissions in Phase 1.
- Webhooks verify the signature, record the delivery id, and acknowledge duplicates without a second link.
- A story key match links the pull request only when the repository is attached to that story’s project and the key belongs to that project.
- Detaching a repository keeps existing links and stops new webhook links.

## 10. Traceability the user can walk

From an accepted requirement, open the story created from it and any decision linked to that requirement.

From a story, open the requirement, the decision, the epic, the milestone, blocking stories, and linked pull requests.

From a pull request link, open the story.

From a decision, open linked requirements and stories, and the decision that superseded it when one exists.

The path Phase 1 must demonstrate:

```
KPI → requirement → decision → story → pull request
```

Deployment, incident, and verified resolution are later phases. The story and the pull request are the forward edge of Phase 1.

## 11. Retention and deletion

- Removing a member keeps audit events and replaces no historical actor with a blank. The user loses access.
- Archiving a project keeps it readable and removes it from the active list. It does not free a Client cap. Client cap counts Clients, not projects.
- Deleting an Agency is confirmed by the Owner and removes tenant rows, GitHub installation tokens, and support requests for that Agency. Audit export before deletion is an Operator action available to the Owner on request in Phase 1. A self-serve export can wait.
- Tokens and webhook secrets are stored as secrets, not in audit summaries or support requests.

## 12. Acceptance checks

1. Create two Agencies. Create a Client, project, discovery, accepted requirement, story, decision, and pull-request link in the first. Confirm the second Agency’s Owner cannot open any of those records by URL or search.
2. In the first Agency, assign an Engineer to one of two Clients. Confirm the other Client’s project is absent from the list and from direct URLs.
3. Accept a discovery and convert two requirements. Confirm two `proposed` stories, links back to the requirements, and audit rows naming the actor.
4. Move a story to `ready` with no acceptance criterion and confirm the product refuses. Add a criterion and confirm it allows the move.
5. Put a story key in a pull-request title for an attached repository and confirm one link. Deliver the same webhook again and confirm there is still one link.
6. Deliver a webhook whose key belongs to a different project and confirm no link is created.
7. Invite until the seat cap and create Clients until the Client cap. Confirm the next invite and the next Client are refused.
8. Set the subscription to `past_due` and confirm reads still open and creates do not.
9. Submit a support request and confirm an operator can reply and cannot list that Agency’s stories.
10. Search a phrase that exists only in another Client and confirm it returns nothing.

## 13. Working assumptions

These keep Phase 1 buildable. They are not alignment locks. Change them in this document if the team chooses otherwise.

- The first release uses a modular monolith and a relational database. Semantic search is Phase 4, so Phase 1 search is keyword search.
- Payment provider is Stripe, implementing the subscription states in section 8.
- One fixed Shopify discovery template, versioned with the product. Agencies cannot edit questions in Phase 1.
- A repository attaches to one project.
- Sprints are not built. Milestones carry the launch date.
- Story estimates are an optional free number with no rollup and no forecast.

## 14. Handoff to Phase 2 — Build and deploy

Phase 2 may assume these records exist and are permissioned: Agency, Client, assignment, project, discovery version, recommendation, requirement, decision, epic, story, acceptance criterion, GitHub installation, repository, pull-request link, knowledge note, audit event, and usage record.

Phase 2 adds Shopify store connections to Clients, a delivery type (theme or app) to projects, and environments, builds, and deployments that hang off the pull-request links. The accepted recommendation's approach is the default delivery type. The GitHub App permission increase in Phase 2 is a reinstall the Agency approves.

Phase 4 adds AI proposals on top of the same records. It does not create a second backlog. Accepting an AI story draft creates a normal story through the same conversion rules, including audit and Client checks.
