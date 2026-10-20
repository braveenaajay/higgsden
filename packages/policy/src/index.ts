export const ROLES = ['owner', 'admin', 'delivery_lead', 'solution_consultant', 'engineer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  delivery_lead: 'Delivery Lead',
  solution_consultant: 'Solution Consultant',
  engineer: 'Engineer',
};

/** Owner and Admin are implicitly assigned to every Client in their Agency. */
export function seesAllClients(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

export type Scope = 'all' | 'assigned' | 'none';

const ALL = 'all' as const;
const A = 'assigned' as const;
const NO = 'none' as const;

/**
 * The permission table. Phase 1 rows come from docs/phase-1-foundation.md section 7.
 * Later rows follow the delivery rules in docs/alignment.md.
 */
const PERMISSIONS = {
  // Phase 1
  'billing.manage': { owner: ALL, admin: NO, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  'agency.delete': { owner: ALL, admin: NO, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  'members.manage': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  'clients.create': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  'projects.create': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  'discovery.edit': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: NO },
  'discovery.accept': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  'requirements.convert': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: NO },
  'decisions.propose': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: NO },
  'decisions.accept': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  'stories.prepare': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: NO },
  'stories.work': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: A },
  'repositories.attach': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  'pullRequests.link': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: A },
  'knowledge.write': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: A },
  'knowledge.verify': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  'support.submit': { owner: ALL, admin: ALL, delivery_lead: ALL, solution_consultant: ALL, engineer: ALL },
  // Phase 2
  'settings.manage': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  'stores.manage': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  'environments.manage': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  'deployments.request': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: A },
  'releases.approve': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  'logs.read': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: A },
  'hosting.manage': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  // Phase 3
  'provisioning.run': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  'provisioning.deprovision': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
  // Phase 4
  'agents.run': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: A },
  'proposals.review': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: NO },
  'plans.approve': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  // Phase 5
  'conversations.handle': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: A, engineer: A },
  'incidents.manage': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: A },
  'resolutions.verify': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  // Phase 6
  'insights.read': { owner: ALL, admin: ALL, delivery_lead: A, solution_consultant: NO, engineer: NO },
  'automation.manage': { owner: ALL, admin: ALL, delivery_lead: NO, solution_consultant: NO, engineer: NO },
} satisfies Record<string, Record<Role, Scope>>;

export type Action = keyof typeof PERMISSIONS;
export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

export interface Actor {
  role: Role;
  /** Client ids the member is assigned to. Ignored for Owner and Admin. */
  assignedClientIds: readonly string[];
}

export function scopeOf(role: Role, action: Action): Scope {
  return PERMISSIONS[action][role];
}

/** For `assigned` actions, pass the Client the record belongs to. Without one, only `all` scopes pass. */
export function can(actor: Actor, action: Action, clientId?: string): boolean {
  const scope = PERMISSIONS[action][actor.role];
  if (scope === 'all') return true;
  if (scope === 'none') return false;
  return clientId !== undefined && actor.assignedClientIds.includes(clientId);
}

/** True when the role has the action on at least one Client, for showing Agency-level navigation. */
export function canAnywhere(actor: Actor, action: Action): boolean {
  const scope = PERMISSIONS[action][actor.role];
  return scope === 'all' || (scope === 'assigned' && actor.assignedClientIds.length > 0);
}

export function canOpenClient(actor: Actor, clientId: string): boolean {
  return seesAllClients(actor.role) || actor.assignedClientIds.includes(clientId);
}

export function allowedActions(actor: Actor, clientId: string): Action[] {
  return ACTIONS.filter((action) => can(actor, action, clientId));
}

// ---------------------------------------------------------------------------
// Subscription state, docs/phase-1-foundation.md section 8.
// ---------------------------------------------------------------------------

export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled';

/** Creates refused while past due. Reads, search, support requests, and running deliveries keep working. */
const BLOCKED_WHEN_PAST_DUE: ReadonlySet<Action> = new Set<Action>([
  'members.manage',
  'clients.create',
  'projects.create',
  'discovery.edit',
  'discovery.accept',
  'requirements.convert',
  'stories.prepare',
  'provisioning.run',
  'agents.run',
]);

export type BillingVerdict = { allowed: true } | { allowed: false; reason: 'past_due' | 'canceled' };

export function billingAllows(state: SubscriptionState, action: Action): BillingVerdict {
  if (state === 'canceled') return action === 'billing.manage' ? { allowed: true } : { allowed: false, reason: 'canceled' };
  if (state === 'past_due' && BLOCKED_WHEN_PAST_DUE.has(action)) return { allowed: false, reason: 'past_due' };
  return { allowed: true };
}

/** A canceled Agency lets the Owner open billing and nothing else, reads included. */
export function canceledAllowsRead(state: SubscriptionState, role: Role, area: 'billing' | 'other'): boolean {
  if (state !== 'canceled') return true;
  return role === 'owner' && area === 'billing';
}

export interface CapCheck {
  allowed: boolean;
  used: number;
  cap: number;
}

export function checkCap(used: number, cap: number): CapCheck {
  return { allowed: used < cap, used, cap };
}

// ---------------------------------------------------------------------------
// Agent action tiers, docs/alignment.md "AI and agents".
// ---------------------------------------------------------------------------

export type ToolTier = 'read' | 'propose' | 'scoped_write' | 'restricted';

export const AGENT_TOOLS = {
  search_knowledge: { tier: 'read', description: 'Hybrid search over verified knowledge, decisions, and prior implementations for this project.' },
  read_story: { tier: 'read', description: 'Read the story, acceptance criteria, linked requirement, and decision.' },
  read_repository_file: { tier: 'read', description: 'Read one file from the attached repository at the default branch.' },
  list_decisions: { tier: 'read', description: 'List architecture decisions for the project.' },
  propose_plan: { tier: 'propose', description: 'Attach an implementation plan to the story for approval.' },
  propose_story: { tier: 'propose', description: 'Propose a story with acceptance criteria.' },
  propose_note: { tier: 'propose', description: 'Propose a knowledge note in proposed state.' },
  propose_reply: { tier: 'propose', description: 'Draft a merchant reply for a person to approve.' },
  push_branch: { tier: 'scoped_write', description: 'Push commits to the one branch this run was issued a token for.' },
  open_pull_request: { tier: 'scoped_write', description: 'Open a pull request from the run branch.' },
  merge_pull_request: { tier: 'restricted', description: 'Merge a pull request.' },
  deploy_production: { tier: 'restricted', description: 'Deploy to production.' },
  approve_release: { tier: 'restricted', description: 'Approve a release.' },
  read_secret: { tier: 'restricted', description: 'Read a secret value.' },
  send_merchant_reply: { tier: 'restricted', description: 'Send a reply to a merchant without approval.' },
  change_member_role: { tier: 'restricted', description: 'Change a member role.' },
  delete_resource: { tier: 'restricted', description: 'Delete hosted infrastructure.' },
} as const satisfies Record<string, { tier: ToolTier; description: string }>;

export type AgentTool = keyof typeof AGENT_TOOLS;

export const SKILLS = ['research', 'plan', 'implement', 'document'] as const;
export type Skill = (typeof SKILLS)[number];

const SKILL_TOOLS: Record<Skill, AgentTool[]> = {
  research: ['search_knowledge', 'read_story', 'read_repository_file', 'list_decisions'],
  plan: ['search_knowledge', 'read_story', 'read_repository_file', 'list_decisions', 'propose_plan'],
  implement: ['read_story', 'read_repository_file', 'search_knowledge', 'push_branch', 'open_pull_request'],
  document: ['read_story', 'search_knowledge', 'propose_note'],
};

/** Restricted tools are never offered to a model, whatever the skill asks for. */
export function toolsForSkill(skill: Skill): AgentTool[] {
  return SKILL_TOOLS[skill].filter((t) => AGENT_TOOLS[t].tier !== 'restricted');
}

export function isToolAllowed(skill: Skill, tool: string): boolean {
  return (toolsForSkill(skill) as string[]).includes(tool);
}

// ---------------------------------------------------------------------------
// Autonomous actions, docs/alignment.md "Phase 6".
// ---------------------------------------------------------------------------

export interface AutonomousAction {
  code: string;
  /** The policy text shown to the Agency. It names exactly what the action may do. */
  policy: string;
  evaluation: string;
  minScore: number;
  dailyBudget: number;
}

export const AUTONOMOUS_ACTIONS: readonly AutonomousAction[] = [
  {
    code: 'ci_failure.explain',
    policy: 'When a build fails, post an explanation of the failure on the linked story as a proposal. It cannot change code or retry the build.',
    evaluation: 'eval-ci-explain-v1',
    minScore: 0.8,
    dailyBudget: 20,
  },
  {
    code: 'story.start_on_pull_request',
    policy: 'When a pull request opens for a ready story, move that story to in progress. It cannot move stories in any other way.',
    evaluation: 'eval-story-start-v1',
    minScore: 0.95,
    dailyBudget: 50,
  },
];

/** Actions that may be configured but always route to the approval path. */
export const APPROVAL_ONLY_ACTIONS = ['release.promote_production', 'merchant.reply', 'story.close_on_merge'] as const;

export const AUTOMATION_TRIGGERS = ['pull_request.opened', 'pull_request.merged', 'build.failed', 'deployment.succeeded', 'incident.opened'] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export function autonomousAction(code: string): AutonomousAction | undefined {
  return AUTONOMOUS_ACTIONS.find((a) => a.code === code);
}

export type AutonomyVerdict =
  | { mode: 'autonomous' }
  | { mode: 'approval'; reason: 'not_allowlisted' | 'evaluation_missing' | 'evaluation_failed' | 'budget_exhausted' };

export function autonomyVerdict(
  code: string,
  latestEvaluation: { passed: boolean; score: number } | null,
  runsToday: number,
  ruleBudget: number,
): AutonomyVerdict {
  const action = autonomousAction(code);
  if (!action) return { mode: 'approval', reason: 'not_allowlisted' };
  if (!latestEvaluation) return { mode: 'approval', reason: 'evaluation_missing' };
  if (!latestEvaluation.passed || latestEvaluation.score < action.minScore) return { mode: 'approval', reason: 'evaluation_failed' };
  if (runsToday >= Math.min(ruleBudget, action.dailyBudget)) return { mode: 'approval', reason: 'budget_exhausted' };
  return { mode: 'autonomous' };
}

// ---------------------------------------------------------------------------
// Story readiness, docs/phase-1-foundation.md section 6.5.
// ---------------------------------------------------------------------------

export type StoryStatus = 'proposed' | 'ready' | 'in_progress' | 'done' | 'canceled';

export type ReadinessProblem = 'description_missing' | 'acceptance_criteria_missing';

export function readinessProblems(story: { description: string; acceptanceCriteriaCount: number }): ReadinessProblem[] {
  const problems: ReadinessProblem[] = [];
  if (!story.description.trim()) problems.push('description_missing');
  if (story.acceptanceCriteriaCount < 1) problems.push('acceptance_criteria_missing');
  return problems;
}

/** Moving into or out of `proposed`/`ready` is preparation. Later moves are work. */
export function actionForStatusChange(from: StoryStatus, to: StoryStatus): Action {
  if (to === 'ready' && from === 'proposed') return 'stories.prepare';
  if (to === 'proposed' || to === 'canceled') return 'stories.prepare';
  return 'stories.work';
}
