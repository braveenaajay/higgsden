import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  halfvec,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const EMBEDDING_DIMENSIONS = 1024;

export const roleEnum = pgEnum('role', ['owner', 'admin', 'delivery_lead', 'solution_consultant', 'engineer']);
export const membershipStatusEnum = pgEnum('membership_status', ['invited', 'active', 'removed']);
export const invitationStatusEnum = pgEnum('invitation_status', ['pending', 'accepted', 'revoked', 'expired']);
export const subscriptionStateEnum = pgEnum('subscription_state', ['trialing', 'active', 'past_due', 'canceled']);
export const projectStatusEnum = pgEnum('project_status', ['active', 'archived']);
export const deliveryTypeEnum = pgEnum('delivery_type', ['theme', 'app']);
export const discoveryStatusEnum = pgEnum('discovery_status', ['draft', 'in_review', 'accepted']);
export const approachEnum = pgEnum('delivery_approach', ['theme', 'custom_app', 'headless', 'hybrid']);
export const kpiCategoryEnum = pgEnum('kpi_category', ['business', 'technical', 'delivery']);
export const requirementTypeEnum = pgEnum('requirement_type', ['functional', 'constraint', 'non_functional']);
export const requirementPriorityEnum = pgEnum('requirement_priority', ['must', 'should', 'could']);
export const requirementStatusEnum = pgEnum('requirement_status', ['captured', 'accepted', 'rejected', 'converted']);
export const decisionStatusEnum = pgEnum('decision_status', ['proposed', 'accepted', 'superseded']);
export const epicStatusEnum = pgEnum('epic_status', ['open', 'done']);
export const storyStatusEnum = pgEnum('story_status', ['proposed', 'ready', 'in_progress', 'done', 'canceled']);
export const verificationStateEnum = pgEnum('verification_state', ['proposed', 'reviewed', 'verified', 'stale', 'superseded']);
export const supportStatusEnum = pgEnum('support_status', ['open', 'answered', 'closed']);
export const pullRequestStateEnum = pgEnum('pull_request_state', ['open', 'closed', 'merged']);
export const workflowStatusEnum = pgEnum('workflow_status', [
  'pending',
  'running',
  'waiting_for_approval',
  'succeeded',
  'failed',
  'canceled',
]);
export const storeRoleEnum = pgEnum('store_role', ['development', 'staging', 'production']);
export const environmentNameEnum = pgEnum('environment_name', ['preview', 'staging', 'production']);
export const deploymentStatusEnum = pgEnum('deployment_status', [
  'pending_approval',
  'approved',
  'rejected',
  'deploying',
  'succeeded',
  'failed',
  'rolled_back',
]);
export const resourceStatusEnum = pgEnum('resource_status', ['pending', 'creating', 'ready', 'failed', 'deleting', 'deleted']);
export const proposalStatusEnum = pgEnum('proposal_status', ['proposed', 'accepted', 'rejected']);
export const conversationStatusEnum = pgEnum('conversation_status', ['open', 'handed_over', 'resolved']);
export const messageAuthorEnum = pgEnum('message_author', ['merchant', 'agent', 'ai', 'system']);
export const incidentSeverityEnum = pgEnum('incident_severity', ['sev1', 'sev2', 'sev3', 'sev4']);
export const incidentStatusEnum = pgEnum('incident_status', ['open', 'mitigated', 'resolved']);
export const automationModeEnum = pgEnum('automation_mode', ['autonomous', 'approval']);
export const teamsModeEnum = pgEnum('teams_mode', ['fake', 'graph']);
export const teamsMatchKindEnum = pgEnum('teams_match_kind', ['organizer', 'subject_prefix']);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const agencyId = () => uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' });
const clientId = () => uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' });
const projectId = () => uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' });
const userRef = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });

// ---------------------------------------------------------------------------
// Global tables. No agency_id, no row-level security.
// ---------------------------------------------------------------------------

/** Better Auth reads and writes these four tables through its Drizzle adapter, so property names follow its model. */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isOperator: boolean('is_operator').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = pgTable('auth_sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authAccounts = pgTable('auth_accounts', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: ts('access_token_expires_at'),
  refreshTokenExpiresAt: ts('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authVerifications = pgTable('auth_verifications', {
  id: id(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const plans = pgTable('plans', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  seatCap: integer('seat_cap').notNull(),
  clientCap: integer('client_cap').notNull(),
  trialDays: integer('trial_days').notNull().default(14),
  monthlyPriceCents: integer('monthly_price_cents').notNull(),
  /** Starting hosting spend cap for Agencies on this plan. */
  defaultSpendCapCents: integer('default_spend_cap_cents').notNull(),
  stripePriceId: text('stripe_price_id'),
});

export const hostingTiers = pgTable('hosting_tiers', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  cpuMillicores: integer('cpu_millicores').notNull(),
  memoryMb: integer('memory_mb').notNull(),
  minReplicas: integer('min_replicas').notNull(),
  maxReplicas: integer('max_replicas').notNull(),
  databaseGb: integer('database_gb').notNull(),
  storageGb: integer('storage_gb').notNull(),
  logRetentionDays: integer('log_retention_days').notNull(),
  bandwidthGb: integer('bandwidth_gb').notNull(),
  previewIdleMinutes: integer('preview_idle_minutes').notNull(),
  monthlyPriceCents: integer('monthly_price_cents').notNull(),
  /** Our estimated AWS cost for one replica-hour, used by the margin views. */
  replicaHourCostCents: numeric('replica_hour_cost_cents').notNull(),
  /** Overage price for one replica-hour above the tier minimum. */
  replicaHourPriceCents: numeric('replica_hour_price_cents').notNull(),
});

export const cells = pgTable('cells', {
  id: text('id').primaryKey(),
  region: text('region').notNull(),
  status: text('status').notNull().default('active'),
  maxPods: integer('max_pods').notNull(),
  usedPods: integer('used_pods').notNull().default(0),
  maxNodes: integer('max_nodes').notNull(),
  usedNodes: integer('used_nodes').notNull().default(0),
  maxIps: integer('max_ips').notNull(),
  usedIps: integer('used_ips').notNull().default(0),
});

export const dbInstances = pgTable('db_instances', {
  id: id(),
  cellId: text('cell_id').notNull().references(() => cells.id),
  envClass: text('env_class').notNull(),
  identifier: text('identifier').notNull().unique(),
  maxDatabases: integer('max_databases').notNull(),
  databaseCount: integer('database_count').notNull().default(0),
});

export const templates = pgTable('templates', {
  code: text('code').primaryKey(),
  kind: deliveryTypeEnum('kind').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  sourceRepo: text('source_repo').notNull(),
});

export const platformArticles = pgTable('platform_articles', {
  id: id(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('draft'),
  authorId: userRef('author_id'),
  reviewerId: userRef('reviewer_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const platformChunks = pgTable(
  'platform_chunks',
  {
    id: id(),
    articleId: uuid('article_id').notNull().references(() => platformArticles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    model: text('model'),
    vector: halfvec('vector', { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', title || ' ' || content)`),
  },
  (t) => [index('platform_chunks_tsv').using('gin', t.tsv)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    provider: text('provider').notNull(),
    deliveryId: text('delivery_id').notNull(),
    agencyId: uuid('agency_id'),
    eventType: text('event_type').notNull(),
    outcome: text('outcome').notNull().default('received'),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex('webhook_deliveries_provider_delivery').on(t.provider, t.deliveryId)],
);

export const operatorAlerts = pgTable('operator_alerts', {
  id: id(),
  kind: text('kind').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  createdAt: createdAt(),
  acknowledgedAt: ts('acknowledged_at'),
});

/** Daily cost and revenue per Agency from the Cost and Usage Report. Operator only. */
export const costReports = pgTable(
  'cost_reports',
  {
    id: id(),
    day: date('day').notNull(),
    agencyId: uuid('agency_id').notNull(),
    costCents: integer('cost_cents').notNull(),
    revenueCents: integer('revenue_cents').notNull(),
    byTier: jsonb('by_tier').$type<Record<string, { costCents: number; revenueCents: number }>>().notNull().default({}),
  },
  (t) => [uniqueIndex('cost_reports_day_agency').on(t.day, t.agencyId)],
);

/** State kept by the local fakes for GitHub, AWS, and Shopify. Never used when real providers are configured. */
export const sandboxResources = pgTable(
  'sandbox_resources',
  {
    id: id(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sandbox_resources_kind_name').on(t.kind, t.name)],
);

export const autonomousEvaluations = pgTable('autonomous_evaluations', {
  id: id(),
  actionCode: text('action_code').notNull(),
  version: text('version').notNull(),
  passed: boolean('passed').notNull(),
  score: numeric('score').notNull(),
  details: text('details').notNull().default(''),
  ranAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Tenant tables. Every row carries agency_id and row-level security applies.
// ---------------------------------------------------------------------------

export const agencies = pgTable('agencies', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  planCode: text('plan_code').notNull().references(() => plans.code),
  subscriptionState: subscriptionStateEnum('subscription_state').notNull().default('trialing'),
  trialEndsAt: ts('trial_ends_at'),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  spendCapCents: integer('spend_cap_cents').notNull(),
  cellId: text('cell_id').references(() => cells.id),
  messageRetentionDays: integer('message_retention_days').notNull().default(365),
  logRetentionDays: integer('log_retention_days').notNull().default(30),
  redactPii: boolean('redact_pii').notNull().default(true),
  requireChatConsent: boolean('require_chat_consent').notNull().default(true),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    agencyId: agencyId(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('memberships_agency_user').on(t.agencyId, t.userId), index('memberships_user').on(t.userId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    agencyId: agencyId(),
    email: text('email').notNull(),
    role: roleEnum('role').notNull(),
    clientIds: jsonb('client_ids').$type<string[]>().notNull().default([]),
    tokenHash: text('token_hash').notNull().unique(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    invitedBy: userRef('invited_by'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('invitations_agency_status').on(t.agencyId, t.status)],
);

export const clients = pgTable(
  'clients',
  {
    id: id(),
    agencyId: agencyId(),
    name: text('name').notNull(),
    summary: text('summary').notNull().default(''),
    /** Public key for the merchant chat widget. */
    widgetKey: text('widget_key').notNull().unique().default(sql`replace(gen_random_uuid()::text, '-', '')`),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('clients_agency').on(t.agencyId)],
);

export const clientAssignments = pgTable(
  'client_assignments',
  {
    id: id(),
    agencyId: agencyId(),
    membershipId: uuid('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
    clientId: clientId(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('client_assignments_membership_client').on(t.membershipId, t.clientId)],
);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    name: text('name').notNull(),
    key: text('key').notNull(),
    summary: text('summary').notNull().default(''),
    status: projectStatusEnum('status').notNull().default('active'),
    deliveryType: deliveryTypeEnum('delivery_type'),
    templateCode: text('template_code').references(() => templates.code),
    partnerAppRegistered: boolean('partner_app_registered').notNull().default(false),
    nextStoryNumber: integer('next_story_number').notNull().default(1),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('projects_agency_key').on(t.agencyId, t.key), index('projects_client').on(t.clientId)],
);

export const discoverySessions = pgTable(
  'discovery_sessions',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: projectId(),
    version: integer('version').notNull().default(1),
    templateVersion: text('template_version').notNull().default('shopify-discovery-v1'),
    status: discoveryStatusEnum('status').notNull().default('draft'),
    answers: jsonb('answers').$type<Record<string, string>>().notNull().default({}),
    recommendation: text('recommendation').notNull().default(''),
    approach: approachEnum('approach'),
    reasons: text('reasons').notNull().default(''),
    acceptedAt: ts('accepted_at'),
    acceptedBy: userRef('accepted_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('discovery_sessions_project_version').on(t.projectId, t.version)],
);

const sessionRef = () => uuid('session_id').notNull().references(() => discoverySessions.id, { onDelete: 'cascade' });

export const kpis = pgTable('kpis', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  sessionId: sessionRef(),
  copiedFromId: uuid('copied_from_id'),
  name: text('name').notNull(),
  category: kpiCategoryEnum('category').notNull(),
  unit: text('unit').notNull().default(''),
  baseline: numeric('baseline'),
  target: numeric('target'),
  source: text('source').notNull().default(''),
  notes: text('notes').notNull().default(''),
  createdAt: createdAt(),
});

export const constraints = pgTable('constraints', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  sessionId: sessionRef(),
  copiedFromId: uuid('copied_from_id'),
  statement: text('statement').notNull(),
  source: text('source').notNull().default(''),
  createdAt: createdAt(),
});

export const risks = pgTable('risks', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  sessionId: sessionRef(),
  copiedFromId: uuid('copied_from_id'),
  statement: text('statement').notNull(),
  impact: text('impact').notNull().default(''),
  mitigation: text('mitigation').notNull().default(''),
  owner: text('owner').notNull().default(''),
  createdAt: createdAt(),
});

export const requirements = pgTable(
  'requirements',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: projectId(),
    sessionId: sessionRef(),
    copiedFromId: uuid('copied_from_id'),
    kpiId: uuid('kpi_id').references(() => kpis.id, { onDelete: 'set null' }),
    statement: text('statement').notNull(),
    type: requirementTypeEnum('type').notNull().default('functional'),
    priority: requirementPriorityEnum('priority').notNull().default('should'),
    status: requirementStatusEnum('status').notNull().default('captured'),
    createdAt: createdAt(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', statement)`),
  },
  (t) => [index('requirements_tsv').using('gin', t.tsv)],
);

export const architectureDecisions = pgTable(
  'architecture_decisions',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: projectId(),
    title: text('title').notNull(),
    status: decisionStatusEnum('status').notNull().default('proposed'),
    context: text('context').notNull().default(''),
    decision: text('decision').notNull().default(''),
    consequences: text('consequences').notNull().default(''),
    supersedesId: uuid('supersedes_id'),
    acceptedBy: userRef('accepted_by'),
    createdAt: createdAt(),
    tsv: tsvector('tsv').generatedAlwaysAs(
      sql`to_tsvector('english', title || ' ' || context || ' ' || decision || ' ' || consequences)`,
    ),
  },
  (t) => [index('architecture_decisions_tsv').using('gin', t.tsv)],
);

export const decisionRequirements = pgTable(
  'decision_requirements',
  {
    agencyId: agencyId(),
    decisionId: uuid('decision_id').notNull().references(() => architectureDecisions.id, { onDelete: 'cascade' }),
    requirementId: uuid('requirement_id').notNull().references(() => requirements.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.decisionId, t.requirementId] })],
);

export const epics = pgTable('epics', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  title: text('title').notNull(),
  outcome: text('outcome').notNull().default(''),
  status: epicStatusEnum('status').notNull().default('open'),
  createdAt: createdAt(),
});

export const milestones = pgTable('milestones', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  name: text('name').notNull(),
  targetDate: date('target_date').notNull(),
  createdAt: createdAt(),
});

export const stories = pgTable(
  'stories',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: projectId(),
    epicId: uuid('epic_id').references(() => epics.id, { onDelete: 'set null' }),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    key: text('key').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** `member` for people, `teams_question` for unanswered meeting questions. */
    source: text('source').notNull().default('member'),
    sourceRef: text('source_ref'),
    status: storyStatusEnum('status').notNull().default('proposed'),
    estimate: numeric('estimate'),
    requirementId: uuid('requirement_id').references(() => requirements.id, { onDelete: 'set null' }),
    decisionId: uuid('decision_id').references(() => architectureDecisions.id, { onDelete: 'set null' }),
    decisionNotRequired: boolean('decision_not_required').notNull().default(false),
    startedAt: ts('started_at'),
    doneAt: ts('done_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', key || ' ' || title || ' ' || description)`),
  },
  (t) => [
    uniqueIndex('stories_agency_key').on(t.agencyId, t.key),
    index('stories_project').on(t.projectId),
    index('stories_project_source').on(t.projectId, t.source),
    index('stories_tsv').using('gin', t.tsv),
  ],
);

const storyRef = () => uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' });

export const acceptanceCriteria = pgTable('acceptance_criteria', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  storyId: storyRef(),
  statement: text('statement').notNull(),
  position: integer('position').notNull(),
});

export const storyTasks = pgTable('story_tasks', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  storyId: storyRef(),
  title: text('title').notNull(),
  done: boolean('done').notNull().default(false),
  position: integer('position').notNull(),
});

/** `blockerStoryId` blocks `storyId`. */
export const storyDependencies = pgTable(
  'story_dependencies',
  {
    id: id(),
    agencyId: agencyId(),
    projectId: projectId(),
    storyId: storyRef(),
    blockerStoryId: uuid('blocker_story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('story_dependencies_pair').on(t.storyId, t.blockerStoryId)],
);

export const knowledgeNotes = pgTable(
  'knowledge_notes',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: projectId(),
    kind: text('kind').notNull().default('note'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    verificationState: verificationStateEnum('verification_state').notNull().default('proposed'),
    authorId: userRef('author_id'),
    storyId: uuid('story_id').references(() => stories.id, { onDelete: 'set null' }),
    pullRequestLinkId: uuid('pull_request_link_id'),
    deploymentId: uuid('deployment_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', title || ' ' || body)`),
  },
  (t) => [index('knowledge_notes_tsv').using('gin', t.tsv)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    agencyId: agencyId(),
    actorId: userRef('actor_id'),
    actorKind: text('actor_kind').notNull().default('member'),
    clientId: uuid('client_id'),
    projectId: uuid('project_id'),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_events_project_created').on(t.projectId, t.createdAt), index('audit_events_agency_created').on(t.agencyId, t.createdAt)],
);

export const usageRecords = pgTable(
  'usage_records',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: uuid('client_id'),
    projectId: uuid('project_id'),
    environmentId: uuid('environment_id'),
    meter: text('meter').notNull(),
    unit: text('unit').notNull().default(''),
    quantity: numeric('quantity').notNull(),
    costCents: numeric('cost_cents').notNull().default('0'),
    priceCents: numeric('price_cents').notNull().default('0'),
    sourceId: text('source_id'),
    periodStart: ts('period_start'),
    periodEnd: ts('period_end'),
    reportedToStripeAt: ts('reported_to_stripe_at'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_records_agency_recorded').on(t.agencyId, t.recordedAt),
    uniqueIndex('usage_records_source').on(t.agencyId, t.meter, t.sourceId),
  ],
);

export const supportRequests = pgTable('support_requests', {
  id: id(),
  agencyId: agencyId(),
  authorId: userRef('author_id'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: supportStatusEnum('status').notNull().default('open'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const supportReplies = pgTable('support_replies', {
  id: id(),
  agencyId: agencyId(),
  requestId: uuid('request_id').notNull().references(() => supportRequests.id, { onDelete: 'cascade' }),
  authorId: userRef('author_id'),
  fromOperator: boolean('from_operator').notNull().default(false),
  body: text('body').notNull(),
  createdAt: createdAt(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    agencyId: agencyId(),
    /** Null means every Owner and Admin of the Agency. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_agency_created').on(t.agencyId, t.createdAt)],
);

export const invoices = pgTable('invoices', {
  id: id(),
  agencyId: agencyId(),
  stripeInvoiceId: text('stripe_invoice_id').notNull().unique(),
  period: text('period').notNull(),
  status: text('status').notNull(),
  totalCents: integer('total_cents').notNull(),
  lines: jsonb('lines').$type<{ description: string; quantity: number; amountCents: number }[]>().notNull().default([]),
  createdAt: createdAt(),
});

// --- GitHub ------------------------------------------------------------------

export const githubInstallations = pgTable('github_installations', {
  id: id(),
  agencyId: agencyId(),
  installationId: bigint('installation_id', { mode: 'number' }).notNull().unique(),
  accountLogin: text('account_login').notNull(),
  /** 1 read-only (Phase 1), 2 adds checks and comments (Phase 2), 3 adds repository creation (Phase 3). */
  permissionLevel: integer('permission_level').notNull().default(1),
  suspendedAt: ts('suspended_at'),
  createdAt: createdAt(),
});

export const repositories = pgTable(
  'repositories',
  {
    id: id(),
    agencyId: agencyId(),
    installationId: uuid('installation_id').notNull().references(() => githubInstallations.id, { onDelete: 'cascade' }),
    githubRepoId: bigint('github_repo_id', { mode: 'number' }).notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    attachedAt: ts('attached_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('repositories_agency_repo').on(t.agencyId, t.githubRepoId), index('repositories_project').on(t.projectId)],
);

export const pullRequestLinks = pgTable(
  'pull_request_links',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: projectId(),
    storyId: storyRef(),
    repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    state: pullRequestStateEnum('state').notNull().default('open'),
    headBranch: text('head_branch'),
    headSha: text('head_sha'),
    linkedBy: text('linked_by').notNull().default('member'),
    openedAt: ts('opened_at'),
    mergedAt: ts('merged_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pull_request_links_repo_number').on(t.repositoryId, t.number)],
);

// --- Microsoft Teams (C12) ------------------------------------------------------

export const teamsConnections = pgTable(
  'teams_connections',
  {
    id: id(),
    agencyId: agencyId(),
    entraTenantId: text('entra_tenant_id').notNull(),
    mode: teamsModeEnum('mode').notNull().default('fake'),
    subscriptionId: text('subscription_id'),
    /** Graph notification clientState. Encrypted at rest; dummy mode stores a fixture string. */
    clientStateEncrypted: text('client_state_encrypted'),
    subscriptionExpiresAt: ts('subscription_expires_at'),
    consentedAt: ts('consented_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('teams_connections_agency').on(t.agencyId),
    uniqueIndex('teams_connections_tenant').on(t.entraTenantId),
  ],
);

export const teamsOrganizers = pgTable(
  'teams_organizers',
  {
    id: id(),
    agencyId: agencyId(),
    connectionId: uuid('connection_id').notNull().references(() => teamsConnections.id, { onDelete: 'cascade' }),
    entraUserId: text('entra_user_id').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('teams_organizers_connection_user').on(t.connectionId, t.entraUserId)],
);

export const teamsProjectMaps = pgTable(
  'teams_project_maps',
  {
    id: id(),
    agencyId: agencyId(),
    connectionId: uuid('connection_id').notNull().references(() => teamsConnections.id, { onDelete: 'cascade' }),
    matchKind: teamsMatchKindEnum('match_kind').notNull(),
    organizerId: uuid('organizer_id').references(() => teamsOrganizers.id, { onDelete: 'cascade' }),
    subjectPrefix: text('subject_prefix'),
    clientId: clientId(),
    projectId: projectId(),
    createdAt: createdAt(),
  },
  (t) => [index('teams_project_maps_connection').on(t.connectionId)],
);

export const meetingTranscripts = pgTable(
  'meeting_transcripts',
  {
    id: id(),
    agencyId: agencyId(),
    connectionId: uuid('connection_id').notNull().references(() => teamsConnections.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    graphMeetingId: text('graph_meeting_id').notNull(),
    graphTranscriptId: text('graph_transcript_id').notNull(),
    organizerEntraUserId: text('organizer_entra_user_id').notNull(),
    subject: text('subject').notNull().default(''),
    joinUrl: text('join_url'),
    startedAt: ts('started_at'),
    rawText: text('raw_text').notNull().default(''),
    processedAt: ts('processed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('meeting_transcripts_agency_graph').on(t.agencyId, t.graphTranscriptId),
    index('meeting_transcripts_project').on(t.projectId),
  ],
);

export const meetingQuestions = pgTable(
  'meeting_questions',
  {
    id: id(),
    agencyId: agencyId(),
    transcriptId: uuid('transcript_id').notNull().references(() => meetingTranscripts.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    storyId: uuid('story_id').references(() => stories.id, { onDelete: 'set null' }),
    duplicateOfStoryId: uuid('duplicate_of_story_id').references(() => stories.id, { onDelete: 'set null' }),
    question: text('question').notNull(),
    quote: text('quote').notNull(),
    speaker: text('speaker'),
    assigneeHint: text('assignee_hint'),
    confidence: numeric('confidence').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('meeting_questions_transcript_quote').on(t.transcriptId, t.quote),
    index('meeting_questions_story').on(t.storyId),
  ],
);

// --- Workflows ------------------------------------------------------------------

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: id(),
    agencyId: agencyId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    status: workflowStatusEnum('status').notNull().default('pending'),
    currentStep: text('current_step'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    /** Starting the same logical run twice (for example a redelivered webhook) returns the first run. */
    dedupeKey: text('dedupe_key'),
    error: text('error'),
    requestedBy: userRef('requested_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [uniqueIndex('workflow_runs_dedupe').on(t.agencyId, t.dedupeKey), index('workflow_runs_project').on(t.projectId, t.createdAt)],
);

export const workflowSteps = pgTable(
  'workflow_steps',
  {
    id: id(),
    agencyId: agencyId(),
    runId: uuid('run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    status: workflowStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    lastError: text('last_error'),
    output: jsonb('output'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('workflow_steps_idempotency').on(t.idempotencyKey)],
);

export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    agencyId: agencyId(),
    queue: text('queue').notNull(),
    jobName: text('job_name').notNull(),
    payload: jsonb('payload').notNull(),
    dispatchedAt: ts('dispatched_at'),
    createdAt: createdAt(),
  },
  (t) => [index('outbox_undispatched').on(t.dispatchedAt, t.createdAt)],
);

// --- Delivery: stores, environments, builds, deployments, logs ------------------

export const storeConnections = pgTable(
  'store_connections',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    domain: text('domain').notNull(),
    storeRole: storeRoleEnum('store_role').notNull(),
    /** Secrets Manager name. The credential itself is never stored in the database. */
    secretRef: text('secret_ref').notNull(),
    liveThemeId: text('live_theme_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('store_connections_agency_domain').on(t.agencyId, t.domain)],
);

export const environments = pgTable(
  'environments',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: projectId(),
    name: environmentNameEnum('name').notNull(),
    url: text('url'),
    namespace: text('namespace'),
    argoApplication: text('argo_application'),
    storeConnectionId: uuid('store_connection_id').references(() => storeConnections.id, { onDelete: 'set null' }),
    tierCode: text('tier_code').references(() => hostingTiers.code),
    autoSync: boolean('auto_sync').notNull().default(false),
    currentVersion: text('current_version'),
    currentReplicas: integer('current_replicas').notNull().default(0),
    /** Replicas the autoscaler would like, from simulated load. */
    desiredReplicas: integer('desired_replicas').notNull().default(0),
    /** Set when the spend cap is reached: the HPA maximum is pinned to the replicas running at that moment. */
    pinnedMaxReplicas: integer('pinned_max_replicas'),
    scaledToZero: boolean('scaled_to_zero').notNull().default(false),
    lastActivityAt: ts('last_activity_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('environments_project_name').on(t.projectId, t.name)],
);

export const builds = pgTable('builds', {
  id: id(),
  agencyId: agencyId(),
  projectId: projectId(),
  workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, { onDelete: 'set null' }),
  commitSha: text('commit_sha').notNull(),
  imageUri: text('image_uri'),
  status: text('status').notNull().default('running'),
  durationSeconds: integer('duration_seconds'),
  createdAt: createdAt(),
  finishedAt: ts('finished_at'),
});

export const gitopsCommits = pgTable('gitops_commits', {
  id: id(),
  agencyId: agencyId(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  repository: text('repository').notNull(),
  path: text('path').notNull(),
  message: text('message').notNull(),
  sha: text('sha').notNull(),
  content: text('content').notNull(),
  authorId: userRef('author_id'),
  createdAt: createdAt(),
});

export const deployments = pgTable(
  'deployments',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: projectId(),
    environmentId: uuid('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    status: deploymentStatusEnum('status').notNull(),
    requestedBy: userRef('requested_by'),
    approvedBy: userRef('approved_by'),
    approvedAt: ts('approved_at'),
    storyId: uuid('story_id').references(() => stories.id, { onDelete: 'set null' }),
    pullRequestLinkId: uuid('pull_request_link_id').references(() => pullRequestLinks.id, { onDelete: 'set null' }),
    gitopsCommitId: uuid('gitops_commit_id').references(() => gitopsCommits.id, { onDelete: 'set null' }),
    previousDeploymentId: uuid('previous_deployment_id'),
    rollbackOfId: uuid('rollback_of_id'),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, { onDelete: 'set null' }),
    /** First commit time of the change, for lead time. */
    changeCommittedAt: ts('change_committed_at'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('deployments_project_created').on(t.projectId, t.createdAt)],
);

export const previewThemes = pgTable('preview_themes', {
  id: id(),
  agencyId: agencyId(),
  projectId: projectId(),
  pullRequestLinkId: uuid('pull_request_link_id').references(() => pullRequestLinks.id, { onDelete: 'cascade' }),
  storeConnectionId: uuid('store_connection_id').notNull().references(() => storeConnections.id, { onDelete: 'cascade' }),
  themeId: text('theme_id').notNull(),
  name: text('name').notNull(),
  previewUrl: text('preview_url').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  deletedAt: ts('deleted_at'),
});

/** Local stand-in for the OpenSearch log indices. Same shape as the documents Fluent Bit ships. */
export const logEntries = pgTable(
  'log_entries',
  {
    id: id(),
    agencyId: agencyId(),
    projectId: projectId(),
    environmentId: uuid('environment_id').references(() => environments.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    stream: text('stream').notNull(),
    level: text('level').notNull().default('info'),
    message: text('message').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('simple', message)`),
  },
  (t) => [index('log_entries_project_ts').on(t.projectId, t.ts), index('log_entries_tsv').using('gin', t.tsv)],
);

// --- Hosting economics ------------------------------------------------------------

export const spendAlerts = pgTable(
  'spend_alerts',
  {
    id: id(),
    agencyId: agencyId(),
    period: text('period').notNull(),
    threshold: integer('threshold').notNull(),
    spendCents: integer('spend_cents').notNull(),
    capCents: integer('cap_cents').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('spend_alerts_period_threshold').on(t.agencyId, t.period, t.threshold, t.capCents)],
);

// --- Provisioning ------------------------------------------------------------------

export const provisionedResources = pgTable(
  'provisioned_resources',
  {
    id: id(),
    agencyId: agencyId(),
    projectId: projectId(),
    environmentId: uuid('environment_id').references(() => environments.id, { onDelete: 'set null' }),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    externalId: text('external_id'),
    status: resourceStatusEnum('status').notNull().default('pending'),
    tags: jsonb('tags').$type<Record<string, string>>().notNull().default({}),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('provisioned_resources_project_kind_name').on(t.projectId, t.kind, t.name)],
);

export const customDomains = pgTable('custom_domains', {
  id: id(),
  agencyId: agencyId(),
  projectId: projectId(),
  environmentId: uuid('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
  hostname: text('hostname').notNull().unique(),
  status: text('status').notNull().default('pending_dns'),
  verificationRecord: text('verification_record').notNull(),
  createdAt: createdAt(),
});

export const dbSnapshots = pgTable('db_snapshots', {
  id: id(),
  agencyId: agencyId(),
  projectId: projectId(),
  identifier: text('identifier').notNull(),
  createdAt: createdAt(),
});

// --- Knowledge retrieval and agents ----------------------------------------------

/** Partitioned by agency_id. Partitions and their HNSW indexes are created when an Agency is created. */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').notNull().defaultRandom(),
    agencyId: agencyId(),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    verificationState: verificationStateEnum('verification_state').notNull(),
    createdAt: createdAt(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', title || ' ' || content)`),
  },
  (t) => [primaryKey({ columns: [t.agencyId, t.id] }), index('knowledge_chunks_source').on(t.agencyId, t.sourceType, t.sourceId)],
);

export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').notNull().defaultRandom(),
    agencyId: agencyId(),
    chunkId: uuid('chunk_id').notNull(),
    model: text('model').notNull(),
    vector: halfvec('vector', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.agencyId, t.id] }), uniqueIndex('embeddings_chunk_model').on(t.agencyId, t.chunkId, t.model)],
);

export const agentRuns = pgTable('agent_runs', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  storyId: uuid('story_id').references(() => stories.id, { onDelete: 'set null' }),
  skill: text('skill').notNull(),
  skillVersion: text('skill_version').notNull(),
  status: text('status').notNull().default('running'),
  model: text('model').notNull(),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb('output').$type<Record<string, unknown>>(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  requestedBy: userRef('requested_by'),
  autonomous: boolean('autonomous').notNull().default(false),
  createdAt: createdAt(),
  finishedAt: ts('finished_at'),
});

export const toolInvocations = pgTable('tool_invocations', {
  id: id(),
  agencyId: agencyId(),
  runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  tool: text('tool').notNull(),
  tier: text('tier').notNull(),
  allowed: boolean('allowed').notNull(),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb('output'),
  reason: text('reason'),
  createdAt: createdAt(),
});

export const proposals = pgTable('proposals', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  storyId: uuid('story_id').references(() => stories.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  citations: jsonb('citations').$type<{ sourceType: string; sourceId: string; title: string; platform?: boolean }[]>().notNull().default([]),
  status: proposalStatusEnum('status').notNull().default('proposed'),
  rejectReason: text('reject_reason'),
  decidedBy: userRef('decided_by'),
  decidedAt: ts('decided_at'),
  resultEntityType: text('result_entity_type'),
  resultEntityId: uuid('result_entity_id'),
  createdAt: createdAt(),
});

// --- Merchant support and incidents ------------------------------------------------

export const slaPolicies = pgTable('sla_policies', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  firstResponseMinutes: integer('first_response_minutes').notNull(),
  resolutionMinutes: integer('resolution_minutes').notNull(),
  createdAt: createdAt(),
});

export const supportConversations = pgTable(
  'support_conversations',
  {
    id: id(),
    agencyId: agencyId(),
    clientId: clientId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    merchantName: text('merchant_name').notNull(),
    merchantEmail: text('merchant_email').notNull(),
    subject: text('subject').notNull(),
    status: conversationStatusEnum('status').notNull().default('open'),
    assigneeId: userRef('assignee_id'),
    slaPolicyId: uuid('sla_policy_id').references(() => slaPolicies.id, { onDelete: 'set null' }),
    firstResponseDueAt: ts('first_response_due_at'),
    resolutionDueAt: ts('resolution_due_at'),
    firstRespondedAt: ts('first_responded_at'),
    resolvedAt: ts('resolved_at'),
    consentAt: ts('consent_at'),
    accessTokenHash: text('access_token_hash').notNull().unique(),
    lastMessageAt: ts('last_message_at'),
    createdAt: createdAt(),
  },
  (t) => [index('support_conversations_agency_status').on(t.agencyId, t.status)],
);

export const supportMessages = pgTable('support_messages', {
  id: id(),
  agencyId: agencyId(),
  conversationId: uuid('conversation_id').notNull().references(() => supportConversations.id, { onDelete: 'cascade' }),
  authorKind: messageAuthorEnum('author_kind').notNull(),
  authorId: userRef('author_id'),
  body: text('body').notNull(),
  redacted: boolean('redacted').notNull().default(false),
  approvedBy: userRef('approved_by'),
  createdAt: createdAt(),
});

export const incidents = pgTable('incidents', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  environmentId: uuid('environment_id').references(() => environments.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  severity: incidentSeverityEnum('severity').notNull(),
  status: incidentStatusEnum('status').notNull().default('open'),
  source: text('source').notNull(),
  dedupeKey: text('dedupe_key'),
  precedingDeploymentId: uuid('preceding_deployment_id').references(() => deployments.id, { onDelete: 'set null' }),
  fixDeploymentId: uuid('fix_deployment_id').references(() => deployments.id, { onDelete: 'set null' }),
  storyId: uuid('story_id').references(() => stories.id, { onDelete: 'set null' }),
  pullRequestLinkId: uuid('pull_request_link_id').references(() => pullRequestLinks.id, { onDelete: 'set null' }),
  conversationId: uuid('conversation_id').references(() => supportConversations.id, { onDelete: 'set null' }),
  evidence: jsonb('evidence').$type<{ logEntryIds: string[]; summary: string }>().notNull().default({ logEntryIds: [], summary: '' }),
  openedAt: createdAt(),
  resolvedAt: ts('resolved_at'),
});

export const resolutions = pgTable('resolutions', {
  id: id(),
  agencyId: agencyId(),
  clientId: clientId(),
  projectId: projectId(),
  incidentId: uuid('incident_id').notNull().unique().references(() => incidents.id, { onDelete: 'cascade' }),
  symptom: text('symptom').notNull(),
  environmentName: text('environment_name').notNull(),
  rootCause: text('root_cause').notNull(),
  fix: text('fix').notNull(),
  affectedVersions: text('affected_versions').notNull(),
  evidence: text('evidence').notNull(),
  verificationState: verificationStateEnum('verification_state').notNull().default('proposed'),
  knowledgeNoteId: uuid('knowledge_note_id').references(() => knowledgeNotes.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const automationRules = pgTable('automation_rules', {
  id: id(),
  agencyId: agencyId(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  trigger: text('trigger').notNull(),
  action: text('action').notNull(),
  mode: automationModeEnum('mode').notNull().default('approval'),
  enabled: boolean('enabled').notNull().default(true),
  dailyBudget: integer('daily_budget').notNull().default(20),
  createdBy: userRef('created_by'),
  createdAt: createdAt(),
});

export const automationRuns = pgTable('automation_runs', {
  id: id(),
  agencyId: agencyId(),
  ruleId: uuid('rule_id').notNull().references(() => automationRules.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id'),
  event: jsonb('event').$type<Record<string, unknown>>().notNull(),
  outcome: text('outcome').notNull(),
  detail: text('detail').notNull().default(''),
  proposalId: uuid('proposal_id'),
  createdAt: createdAt(),
});

/** Tables that carry agency_id and get the standard row-level security policy. */
export const TENANT_TABLES = [
  'invitations',
  'clients',
  'client_assignments',
  'projects',
  'discovery_sessions',
  'kpis',
  'constraints',
  'risks',
  'requirements',
  'architecture_decisions',
  'decision_requirements',
  'epics',
  'milestones',
  'stories',
  'acceptance_criteria',
  'story_tasks',
  'story_dependencies',
  'knowledge_notes',
  'audit_events',
  'usage_records',
  'support_requests',
  'support_replies',
  'notifications',
  'invoices',
  'github_installations',
  'repositories',
  'pull_request_links',
  'teams_connections',
  'teams_organizers',
  'teams_project_maps',
  'meeting_transcripts',
  'meeting_questions',
  'workflow_runs',
  'workflow_steps',
  'outbox',
  'store_connections',
  'environments',
  'builds',
  'gitops_commits',
  'deployments',
  'preview_themes',
  'log_entries',
  'spend_alerts',
  'provisioned_resources',
  'custom_domains',
  'db_snapshots',
  'knowledge_chunks',
  'embeddings',
  'agent_runs',
  'tool_invocations',
  'proposals',
  'sla_policies',
  'support_conversations',
  'support_messages',
  'incidents',
  'resolutions',
  'automation_rules',
  'automation_runs',
] as const;
