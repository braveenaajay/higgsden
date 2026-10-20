import { describe, expect, it } from 'vitest';
import {
  autonomyVerdict,
  billingAllows,
  can,
  canceledAllowsRead,
  checkCap,
  isToolAllowed,
  readinessProblems,
  toolsForSkill,
  AGENT_TOOLS,
  SKILLS,
} from './index.js';

const A1 = 'client-a1';
const A2 = 'client-a2';

describe('permission table', () => {
  it('gives Owner and Admin every Client', () => {
    expect(can({ role: 'owner', assignedClientIds: [] }, 'discovery.accept', A1)).toBe(true);
    expect(can({ role: 'admin', assignedClientIds: [] }, 'members.manage')).toBe(true);
  });

  it('limits assigned roles to their Clients', () => {
    const engineer = { role: 'engineer' as const, assignedClientIds: [A1] };
    expect(can(engineer, 'stories.work', A1)).toBe(true);
    expect(can(engineer, 'stories.work', A2)).toBe(false);
    expect(can(engineer, 'stories.work')).toBe(false);
  });

  it('lets a Solution Consultant prepare but not accept', () => {
    const sc = { role: 'solution_consultant' as const, assignedClientIds: [A1] };
    expect(can(sc, 'stories.prepare', A1)).toBe(true);
    expect(can(sc, 'decisions.propose', A1)).toBe(true);
    expect(can(sc, 'decisions.accept', A1)).toBe(false);
    expect(can(sc, 'discovery.accept', A1)).toBe(false);
  });

  it('keeps billing with the Owner only', () => {
    expect(can({ role: 'admin', assignedClientIds: [] }, 'billing.manage')).toBe(false);
    expect(can({ role: 'owner', assignedClientIds: [] }, 'billing.manage')).toBe(true);
  });

  it('refuses production approval to Engineers and allows it to Delivery Leads', () => {
    expect(can({ role: 'engineer', assignedClientIds: [A1] }, 'releases.approve', A1)).toBe(false);
    expect(can({ role: 'delivery_lead', assignedClientIds: [A1] }, 'releases.approve', A1)).toBe(true);
  });
});

describe('billing states', () => {
  it('refuses creates while past due and allows reads and support', () => {
    expect(billingAllows('past_due', 'members.manage')).toEqual({ allowed: false, reason: 'past_due' });
    expect(billingAllows('past_due', 'clients.create').allowed).toBe(false);
    expect(billingAllows('past_due', 'support.submit').allowed).toBe(true);
    expect(billingAllows('past_due', 'stories.work').allowed).toBe(true);
  });

  it('leaves only billing when canceled', () => {
    expect(billingAllows('canceled', 'billing.manage').allowed).toBe(true);
    expect(billingAllows('canceled', 'support.submit').allowed).toBe(false);
    expect(canceledAllowsRead('canceled', 'owner', 'billing')).toBe(true);
    expect(canceledAllowsRead('canceled', 'admin', 'billing')).toBe(false);
    expect(canceledAllowsRead('canceled', 'owner', 'other')).toBe(false);
  });

  it('counts caps as used below cap', () => {
    expect(checkCap(4, 5).allowed).toBe(true);
    expect(checkCap(5, 5)).toEqual({ allowed: false, used: 5, cap: 5 });
  });
});

describe('agent tools', () => {
  it('never offers a restricted tool to any skill', () => {
    for (const skill of SKILLS) {
      for (const tool of toolsForSkill(skill)) expect(AGENT_TOOLS[tool].tier).not.toBe('restricted');
    }
    expect(isToolAllowed('implement', 'deploy_production')).toBe(false);
    expect(isToolAllowed('implement', 'merge_pull_request')).toBe(false);
    expect(isToolAllowed('implement', 'open_pull_request')).toBe(true);
    expect(isToolAllowed('research', 'push_branch')).toBe(false);
  });
});

describe('autonomy', () => {
  it('runs only allowlisted actions with a passing evaluation inside budget', () => {
    expect(autonomyVerdict('ci_failure.explain', { passed: true, score: 0.9 }, 0, 20)).toEqual({ mode: 'autonomous' });
    expect(autonomyVerdict('merchant.reply', { passed: true, score: 1 }, 0, 20)).toEqual({ mode: 'approval', reason: 'not_allowlisted' });
    expect(autonomyVerdict('ci_failure.explain', null, 0, 20)).toEqual({ mode: 'approval', reason: 'evaluation_missing' });
    expect(autonomyVerdict('ci_failure.explain', { passed: true, score: 0.5 }, 0, 20)).toEqual({ mode: 'approval', reason: 'evaluation_failed' });
    expect(autonomyVerdict('ci_failure.explain', { passed: true, score: 0.9 }, 5, 5)).toEqual({ mode: 'approval', reason: 'budget_exhausted' });
  });
});

describe('story readiness', () => {
  it('needs a description and one acceptance criterion', () => {
    expect(readinessProblems({ description: '', acceptanceCriteriaCount: 0 })).toEqual(['description_missing', 'acceptance_criteria_missing']);
    expect(readinessProblems({ description: 'x', acceptanceCriteriaCount: 1 })).toEqual([]);
  });
});
