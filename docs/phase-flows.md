# Phase flows

Parent: [alignment.md](alignment.md). Phase 1 follows [phase-1-foundation.md](phase-1-foundation.md). Phases 2–6 follow the outlines in [phase-plan.md](phase-plan.md) and will change when those documents are written. The single end-to-end view is [capability-flow.md](capability-flow.md).

Every flow runs inside one Agency. Agency id is checked first, then Client assignment, on every read, search, webhook, pipeline, log view, and AI context.

## How the phases connect

```mermaid
flowchart LR
    P1["1 Foundation<br/>discovery → stories → pull request"]
    P2["2 Build and deploy<br/>preview themes, ECR, Argo CD, logs"]
    P3["3 Provisioning<br/>template → repo + infrastructure"]
    P4["4 AI workflow<br/>Claude skills + Teams questions → stories"]
    P5["5 Support and operations<br/>merchant issue → verified fix"]
    P6["6 Intelligence and autonomy<br/>evidence-backed risk, allowlisted actions"]

    P1 -- "stories linked to pull requests" --> P2
    P2 -- "proven pipelines" --> P3
    P3 -- "platform-controlled repos and environments" --> P4
    P4 -- "proposals, approvals, implementation notes" --> P5
    P5 -- "deployments, incidents, recovery times" --> P6
    P6 -. "actions outside the allowlist" .-> P4
```

## Phase 1 — Foundation

```mermaid
flowchart TD
    subgraph Setup["Agency setup"]
        A1["Sign up"] --> A2["Agency + Owner membership + trial"]
        A2 --> A3{"Client cap reached?"}
        A3 -- "no" --> A4["Create Client"]
        A3 -- "yes" --> A3x["Refused, show cap and use"]
        A4 --> A5["Create project with key"]
        A2 --> M1{"Seat cap reached?"}
        M1 -- "no" --> M2["Invite member, set role"]
        M1 -- "yes" --> M1x["Refused"]
        M2 --> M3["Assign Clients to Delivery Lead,<br/>Solution Consultant, or Engineer"]
    end

    subgraph Discovery["Discovery, Solution Consultant"]
        D1["Shopify template: store, KPIs with baseline and target,<br/>delivery shape, integrations, constraints, risks"]
        D1 --> D2["in_review"]
        D2 --> D3{"Delivery Lead accepts?"}
        D3 -- "yes" --> D3a["accepted, version frozen"]
        D3 -- "changes" --> D1
        D3a --> D4{"Each requirement"}
        D4 -- "accepted" --> D5["Convert"]
        D4 -- "rejected" --> D6["Kept as rejected, no story"]
    end

    subgraph Backlog["Stories, Solution Consultant prepares"]
        B1["Story in proposed, linked to requirement"]
        B2["Decision proposed by consultant,<br/>accepted by Delivery Lead"]
        B3{"Description and at least one acceptance criterion?"}
        B4["ready"] --> B5["in_progress, Engineer"] --> B6["done"]
        B1 --> B3
        B2 -.-> B1
        B3 -- "yes" --> B4
        B3 -- "no" --> B3x["Refused"]
    end

    subgraph GitHub["GitHub, read-only"]
        G1["Admin installs GitHub App"] --> G2["Attach repository to one project"]
        G2 --> G3["Pull-request webhook"]
        G3 --> G4{"Signature valid, new delivery id,<br/>repo attached, key in this project?"}
        G4 -- "yes" --> G5["Link pull request to story"]
        G4 -- "no" --> G6["Ignored"]
    end

    A5 --> D1
    D5 --> B1
    G5 --> B5
    D3a -. "audit" .-> AU[("Audit history")]
    D5 -. "audit" .-> AU
    G5 -. "audit" .-> AU
```

## Phase 2 — Build and deploy

```mermaid
flowchart TD
    S0["Client Shopify store connected<br/>credentials in Secrets Manager"]
    S1["Project delivery type set"]
    PR["Pull request opened on a linked repository"]
    S0 --> S1 --> PR
    PR --> T{"Delivery type"}

    subgraph Theme["Theme pipeline"]
        TH1["Push unpublished preview theme named for the pull request"]
        TH2["Preview link on pull request and story"]
        TH3{"Merged and approved?"}
        TH4["Push to live theme"]
        TH5["Delete preview theme on close"]
        TH1 --> TH2 --> TH3
        TH3 -- "yes" --> TH4
        TH3 -- "closed" --> TH5
        TH4 --> TH5
    end

    subgraph App["App pipeline"]
        AP1["CodeBuild runs buildspec.yml<br/>assumes role scoped to project ECR"]
        AP2["docker build from Dockerfile"]
        AP3["Push image tagged with commit to ECR"]
        AP4["Commit image tag to GitOps repository"]
        AP5["Argo CD syncs staging on EKS"]
        AP6{"Production promotion approved?"}
        AP7["Argo CD syncs production"]
        UI["Deploy from UI:<br/>pick tag and environment"]
        AP1 --> AP2 --> AP3 --> AP4 --> AP5 --> AP6
        AP6 -- "yes" --> AP7
        UI --> AP4
    end

    T -- "theme" --> TH1
    T -- "app" --> AP1

    TH4 --> DEP["Deployment record: environment, version, actor, result"]
    AP5 --> DEP
    AP7 --> DEP
    DEP --> RB["Rollback: previous theme or previous tag"]

    AP1 -.-> LOG[("OpenSearch, Agency document-level security")]
    AP5 -.-> LOG
    AP7 -.-> LOG
    LOG --> LV["Log view filtered to project and environment"]
    AP1 -.-> US[("Usage: build minutes, hosted compute")]
```

### Hosting, scaling, and spend in Phase 2

```mermaid
flowchart TD
    TR["Traffic"] --> WAF["CloudFront + AWS WAF, rate limits"]
    WAF --> NLB["Cell Network Load Balancer"]
    NLB --> GW["Envoy Gateway, routes by host name"]
    GW --> POD["App pods in the Agency namespace"]
    POD --> PX["RDS Proxy"] --> DB[("Shared RDS instance,<br/>own database and user")]

    POD --> HPA{"Load above target?"}
    HPA -- "yes" --> MAX{"Below tier maximum<br/>and under spend cap?"}
    MAX -- "yes" --> UP["Add pods, Karpenter adds nodes"]
    MAX -- "no" --> HOLD["Hold at current replicas, keep serving"]

    OC["OpenCost per namespace, hourly"] --> UR[("usage_records on the Agency")]
    UR --> SP{"Spend against cap"}
    SP -- "50% or 80%" --> AL["Alert the Owner"]
    SP -- "100%" --> PIN["Pin maximum to current replicas<br/>alert the Owner"]
    PIN --> RAISE["Owner raises the cap"] --> RESTORE["Tier maximum restored"]
    UR --> STR["Stripe meters and billing thresholds"]
```

## Phase 3 — Provisioning

```mermaid
flowchart TD
    N1["New project from template"] --> N2{"Theme or app?"}

    N2 -- "theme" --> TT1["Create repository from theme template<br/>in the Agency's GitHub organization"]
    TT1 --> TT2["Wire preview pipeline to Client store"]

    N2 -- "app" --> CELL{"Agency already in a cell?"}
    CELL -- "no" --> PLACE["Assign the Agency to a cell with capacity"] --> AT1
    CELL -- "yes" --> AT1["Create repository from app template<br/>Dockerfile, buildspec.yml, manifests"]
    AT1 --> CLAIM["Commit Crossplane claim to the Agency GitOps repository"]
    CLAIM --> RUN["Argo CD applies, Crossplane creates,<br/>provisioning run reports per-resource status"]
    RUN --> R1["ECR repository"]
    RUN --> R2["Namespace, quotas and limits from the hosting tier,<br/>network policy, tag-based workload identity"]
    RUN --> R3["Database and user on the least-loaded<br/>shared RDS instance in the cell"]
    RUN --> R4["Secrets Manager entries, delivered to pods"]
    RUN --> R5["App URL: DNS, cert-manager TLS, gateway route"]
    RUN --> R6["Argo CD application per environment"]
    RUN --> R7["Log routing to OpenSearch"]
    R1 & R2 & R3 & R4 & R5 & R6 & R7 --> CHK{"All resources ready?"}
    CHK -- "no" --> RETRY["Retry or resume failed resources"] --> RUN
    CHK -- "yes" --> FB["First build through Phase 2 pipeline"]
    FB --> UP["Staging URL responds"]

    TT2 --> READY["Project ready for stories"]
    UP --> READY
    RUN -.-> TAG[("Tagged Agency, Client, Project<br/>metered on the Agency")]

    ARC["Project archived"] --> DA{"Deprovision approved?"}
    DA -- "yes" --> SNAP["Database snapshot"] --> DEL["Remove resources"]
```

## Phase 4 — AI workflow

```mermaid
flowchart TD
    ST["Ready story"] --> CTX["Context: Agency id, then Client assignment<br/>repo, logs, transcripts treated as data"]

    subgraph RPI["Claude skills"]
        R["Research: prior implementations,<br/>verified knowledge, decisions, repository"]
        P["Plan attached to story"]
        PA{"Plan approved by a person?"}
        I["Implement on a branch"]
        PRQ["Open pull request"]
        R --> P --> PA
        PA -- "yes" --> I --> PRQ
        PA -- "changes" --> P
    end

    CTX --> R
    PRQ --> PIPE["Phase 2 pipeline: preview theme or staging build"]
    PIPE --> REV{"Human review and merge"}
    REV -- "merged and deployed" --> DOC["Document skill: implementation note<br/>linked to story, pull request, deployment"]
    DOC --> KN["Knowledge in proposed state"] --> KR{"Reviewed?"}
    KR -- "yes" --> KV["Reviewed knowledge"] -.-> R

    subgraph Teams["C12 Teams listen"]
        TM["Graph transcript webhook"]
        CLS["Classifier: unanswered question?"]
        MAP{"Mapped to a project?"}
        DUPQ{"Duplicate of an existing story?"}
        ST["Create story, status proposed"]
        TM --> MAP
        MAP -- "yes" --> CLS
        MAP -- "no" --> SKIP["Store transcript, create nothing"]
        CLS --> DUPQ
        DUPQ -- "no" --> ST
        DUPQ -- "yes" --> LINK["Link quote on existing story"]
    end

    subgraph Drafts["Other proposals"]
        DR1["Story and acceptance-criteria drafts"]
        DR2["Meeting transcript → decisions, actions, risks"]
        DR3["Pull-request summary, CI failure explanation"]
    end
    CTX --> Drafts
    CTX --> TM
    Drafts --> DUP{"Duplicate?"} --> Q["Review queue"]
    Q -- "accept" --> REC["Normal Phase 1 record + audit"]
    Q -- "reject" --> RJ["Kept with reason"]
    ST --> B1["Backlog, still proposed until a person marks ready"]

    X["Blocked for Claude: merge, production promotion,<br/>live theme, infrastructure, secrets, external messages"]
    RPI -.-> US[("Token usage on the Agency")]
```

## Phase 5 — Support and operations

```mermaid
flowchart TD
    C1["Merchant reports an issue"] --> C2["Support conversation"]
    AL["Alert from hosted app or log pattern"] --> I1
    C2 --> SLA[("SLA clock")]
    C2 --> Q1["Agent queue, assignment, handover"]

    Q1 --> T1["AI triage proposal<br/>severity, known fix, draft reply"]
    T1 --> T2{"Reply approved?"}
    T2 -- "yes" --> T3["Sent to merchant"]

    Q1 --> D1{"Needs engineering?"}
    D1 -- "no" --> RS["Resolution record"]
    D1 -- "yes" --> I1["Incident or bug<br/>customer impact, prior deployment, OpenSearch evidence"]
    I1 --> S1["Story"] --> PR["Pull request"] --> PIPE["Phase 2 pipeline"] --> DEP["Deployment"] --> RS

    RS --> K1["proposed"] --> K2["reviewed"] --> K3["verified"]
    K3 -.-> K4["stale or superseded"]
    K3 --> SR["Searchable in the same Agency"] -.-> T1
```

## Phase 6 — Intelligence and autonomy

```mermaid
flowchart TD
    E["Stories, builds, deployments, incidents,<br/>approvals, hosted cost"] --> M1["DORA, flow, quality, support, AI acceptance<br/>team and system level"]
    M1 --> M2["Explainable rules first, model later"]
    M2 --> RISK["Blocked work, milestone risk, release readiness,<br/>cost per project, with evidence"]
    RISK --> VIEW["Agency view, no individual ranking"]

    EV["Event: pull request, build, deployment, incident"] --> POL{"Allowlisted, evaluated, within budget?"}
    POL -- "yes" --> AUTO["Autonomous action"] --> AU[("Audit, attributable run")]
    POL -- "no" --> MAN["Phase 4 approval path"]
    AUTO --> CHK{"Cost or error rate over limit?"}
    CHK -- "yes" --> MAN
```
