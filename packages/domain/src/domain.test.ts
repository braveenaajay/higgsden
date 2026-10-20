import { describe, expect, it } from 'vitest';
import {
  blockedWork,
  capReached,
  computeUsage,
  desiredReplicasForLoad,
  doraMetrics,
  extractStoryKeys,
  milestoneRisk,
  nextReplicas,
  redactPii,
  renderWorkload,
  shouldScaleToZero,
  similarity,
  thresholdsReached,
} from './index.js';

describe('scaling', () => {
  const base = { currentReplicas: 2, desiredReplicas: 2, minReplicas: 2, maxReplicas: 6, pinnedMaxReplicas: null, scaledToZero: false };

  it('scales up to the tier maximum and no further', () => {
    expect(nextReplicas({ ...base, desiredReplicas: desiredReplicasForLoad(250) })).toBe(5);
    expect(nextReplicas({ ...base, desiredReplicas: desiredReplicasForLoad(5000) })).toBe(6);
  });

  it('stops scaling up at the pinned maximum but keeps what is running', () => {
    expect(nextReplicas({ ...base, currentReplicas: 4, desiredReplicas: 10, pinnedMaxReplicas: 4 })).toBe(4);
  });

  it('never goes below the tier minimum', () => {
    expect(nextReplicas({ ...base, desiredReplicas: 0 })).toBe(2);
  });

  it('scales idle previews to zero', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(shouldScaleToZero({ environment: 'preview', lastActivityAt: new Date('2026-10-20T10:00:00Z'), idleMinutes: 60, now })).toBe(true);
    expect(shouldScaleToZero({ environment: 'staging', lastActivityAt: new Date('2026-10-20T10:00:00Z'), idleMinutes: 60, now })).toBe(false);
  });
});

describe('spend', () => {
  it('reports thresholds at 50, 80, and 100 percent', () => {
    expect(thresholdsReached(4_999, 10_000)).toEqual([]);
    expect(thresholdsReached(8_000, 10_000)).toEqual([50, 80]);
    expect(thresholdsReached(10_000, 10_000)).toEqual([50, 80, 100]);
    expect(capReached(10_000, 10_000)).toBe(true);
  });

  it('meters replica hours at cost and price', () => {
    expect(computeUsage({ replicas: 3, hours: 2, replicaHourCostCents: 1.8, replicaHourPriceCents: 4 })).toEqual({ quantity: 6, costCents: 10.8, priceCents: 24 });
  });
});

describe('text', () => {
  it('finds story keys in titles and branches', () => {
    expect(extractStoryKeys('ACME-12 Filters', 'Fixes BLUE-3', 'acme-14-size-guide')).toEqual(['ACME-12', 'BLUE-3', 'ACME-14']);
    expect(extractStoryKeys('no keys here')).toEqual([]);
  });

  it('redacts emails, phone numbers, and card numbers', () => {
    const out = redactPii('Mail jo@acme.test or call +1 415 555 0100, card 4242 4242 4242 4242');
    expect(out.redacted).toBe(true);
    expect(out.text).not.toMatch(/acme\.test|4242|555/);
  });

  it('scores near-duplicate statements', () => {
    expect(similarity('Show a size guide drawer on product pages', 'Size guide drawer on the product page')).toBeGreaterThan(0.6);
    expect(similarity('Gift bundles', 'Renewal dates')).toBe(0);
  });
});

describe('intelligence', () => {
  const d = (id: string, status: string, day: number, leadHours = 24) => ({
    id,
    environment: 'production',
    status,
    createdAt: new Date(Date.UTC(2026, 9, day)),
    finishedAt: new Date(Date.UTC(2026, 9, day, 1)),
    changeCommittedAt: new Date(Date.UTC(2026, 9, day, 1) - leadHours * 3_600_000),
    rollbackOfId: null,
  });

  it('computes the five DORA metrics with evidence', () => {
    const deployments = [d('a', 'succeeded', 1), d('b', 'failed', 3), d('c', 'succeeded', 5, 48), d('e', 'succeeded', 7)];
    const incidents = [{ id: 'i', openedAt: new Date(Date.UTC(2026, 9, 5, 2)), resolvedAt: new Date(Date.UTC(2026, 9, 5, 6)), precedingDeploymentId: 'c', fixDeploymentId: 'e' }];
    const m = doraMetrics(deployments, incidents, 14);
    expect(m.deploymentFrequency.value).toBe(1.5);
    expect(m.changeLeadTime.value).toBe(24);
    expect(m.changeFailureRate.value).toBe(50);
    expect(m.failedDeploymentRecoveryTime.value).toBe(4);
    expect(m.deploymentReworkRate.value).toBe(25);
    expect(m.changeFailureRate.evidence).toContain('2 of 4');
  });

  it('explains blocked work and milestone risk', () => {
    const stories = [
      { id: '1', key: 'A-1', title: 'One', status: 'in_progress', milestoneId: 'm', startedAt: null, doneAt: null },
      { id: '2', key: 'A-2', title: 'Two', status: 'proposed', milestoneId: 'm', startedAt: null, doneAt: null },
    ];
    const blocked = blockedWork({ stories, dependencies: [{ storyId: '2', blockerStoryId: '1' }], openPullRequests: [], latestBuildFailed: null });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.evidence[0]).toContain('Blocked by A-1');

    const risk = milestoneRisk({ name: 'Launch', targetDate: new Date('2026-10-27'), stories, doneLast28Days: 1, now: new Date('2026-10-20') });
    expect(risk.level).toBe('high');
    expect(risk.evidence).toHaveLength(4);
  });
});

describe('gitops', () => {
  it('renders HPA bounds from the tier and the pinned maximum', () => {
    const spec = {
      agencySlug: 'northwind', agencyId: 'a', clientId: 'c', projectId: 'p', projectKey: 'BLUE', environment: 'production' as const,
      namespace: 'northwind-blue-production', host: 'blue.apps.test', image: 'repo:sha',
      tier: { code: 'standard', cpuMillicores: 500, memoryMb: 1024, minReplicas: 2, maxReplicas: 6, storageGb: 20 },
      pinnedMaxReplicas: null, scaledToZero: false,
    };
    expect(renderWorkload(spec)).toContain('maxReplicas: 6');
    expect(renderWorkload({ ...spec, pinnedMaxReplicas: 3 })).toContain('maxReplicas: 3');
  });
});
