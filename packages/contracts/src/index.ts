import type { Action, Role } from '@higgsden/policy';

export type { Action, Role } from '@higgsden/policy';
export { ROLE_LABELS } from '@higgsden/policy';
export { APPROACHES, DISCOVERY_SECTIONS, DISCOVERY_TEMPLATE_VERSION, KPI_CATALOG } from './discovery-template.js';

export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled';
export type DiscoveryStatus = 'draft' | 'in_review' | 'accepted';
export type RequirementStatus = 'captured' | 'accepted' | 'rejected' | 'converted';
export type DecisionStatus = 'proposed' | 'accepted' | 'superseded';
export type StoryStatus = 'proposed' | 'ready' | 'in_progress' | 'done' | 'canceled';
export type VerificationState = 'proposed' | 'reviewed' | 'verified' | 'stale' | 'superseded';

export interface MeResponse {
  user: { id: string; email: string; name: string; isOperator?: boolean };
  memberships: {
    agencyId: string;
    agencyName: string;
    agencySlug: string;
    role: Role;
    subscriptionState: SubscriptionState;
  }[];
}

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  summary: string;
  status: 'active' | 'archived';
  storyCount: number;
}

export interface ClientWithProjects {
  id: string;
  name: string;
  summary: string;
  projects: ProjectSummary[];
}

export interface WorkspaceResponse {
  agency: { id: string; name: string; planCode: string; subscriptionState: SubscriptionState };
  role: Role;
  seesAllClients: boolean;
  clients: ClientWithProjects[];
}

export interface ProjectDetail {
  project: ProjectSummary & { clientId: string; clientName: string };
  allowedActions: Action[];
  discovery: {
    id: string;
    version: number;
    status: DiscoveryStatus;
    recommendation: string;
    kpis: {
      id: string;
      name: string;
      category: 'business' | 'technical' | 'delivery';
      unit: string;
      baseline: string;
      target: string;
      source: string;
    }[];
    requirements: {
      id: string;
      statement: string;
      type: 'functional' | 'constraint' | 'non_functional';
      priority: 'must' | 'should' | 'could';
      status: RequirementStatus;
    }[];
  } | null;
  decisions: {
    id: string;
    title: string;
    status: DecisionStatus;
    decision: string;
  }[];
  epics: {
    id: string;
    title: string;
    outcome: string;
    stories: {
      id: string;
      key: string;
      title: string;
      status: StoryStatus;
      requirementId: string | null;
      decisionId: string | null;
      acceptanceCriteria: string[];
    }[];
  }[];
  knowledge: {
    id: string;
    title: string;
    body: string;
    verificationState: VerificationState;
  }[];
  activity: {
    id: string;
    action: string;
    summary: string;
    actorName: string;
    createdAt: string;
  }[];
}
