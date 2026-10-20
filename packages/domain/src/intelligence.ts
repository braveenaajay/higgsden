// Delivery intelligence, docs/alignment.md Phase 6. Team and system level only: nothing here takes a person.

export interface DeploymentFact {
  id: string;
  environment: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  changeCommittedAt: Date | null;
  rollbackOfId: string | null;
}

export interface IncidentFact {
  id: string;
  openedAt: Date;
  resolvedAt: Date | null;
  precedingDeploymentId: string | null;
  fixDeploymentId: string | null;
}

export interface Metric {
  value: number | null;
  unit: string;
  evidence: string;
}

export interface DoraMetrics {
  deploymentFrequency: Metric;
  changeLeadTime: Metric;
  changeFailureRate: Metric;
  failedDeploymentRecoveryTime: Metric;
  deploymentReworkRate: Metric;
}

const HOUR = 3_600_000;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** The five DORA metrics over production deployments in the window. */
export function doraMetrics(deployments: DeploymentFact[], incidents: IncidentFact[], windowDays: number): DoraMetrics {
  const prod = deployments.filter((d) => d.environment === 'production' && d.status !== 'pending_approval' && d.status !== 'rejected');
  const succeeded = prod.filter((d) => d.status === 'succeeded');
  const causedIncident = new Set(incidents.map((i) => i.precedingDeploymentId).filter(Boolean) as string[]);
  const failed = prod.filter((d) => d.status === 'failed' || d.status === 'rolled_back' || causedIncident.has(d.id));
  const fixes = new Set(incidents.map((i) => i.fixDeploymentId).filter(Boolean) as string[]);
  const rework = prod.filter((d) => d.rollbackOfId || fixes.has(d.id));

  const leadTimes = succeeded.flatMap((d) => (d.changeCommittedAt && d.finishedAt ? [(d.finishedAt.getTime() - d.changeCommittedAt.getTime()) / HOUR] : []));
  const recoveries = incidents.flatMap((i) => (i.resolvedAt && i.precedingDeploymentId ? [(i.resolvedAt.getTime() - i.openedAt.getTime()) / HOUR] : []));

  const weeks = Math.max(1, windowDays / 7);
  return {
    deploymentFrequency: { value: round1(succeeded.length / weeks), unit: 'per week', evidence: `${succeeded.length} successful production deployments in ${windowDays} days` },
    changeLeadTime: { value: round1(median(leadTimes)), unit: 'hours, median', evidence: `${leadTimes.length} deployments with a recorded first commit time` },
    changeFailureRate: {
      value: prod.length ? round1((failed.length / prod.length) * 100) : null,
      unit: '%',
      evidence: `${failed.length} of ${prod.length} production deployments failed, were rolled back, or preceded an incident`,
    },
    failedDeploymentRecoveryTime: { value: round1(median(recoveries)), unit: 'hours, median', evidence: `${recoveries.length} resolved incidents linked to a deployment` },
    deploymentReworkRate: {
      value: prod.length ? round1((rework.length / prod.length) * 100) : null,
      unit: '%',
      evidence: `${rework.length} of ${prod.length} production deployments were rollbacks or incident fixes`,
    },
  };
}

export interface StoryFact {
  id: string;
  key: string;
  title: string;
  status: string;
  milestoneId: string | null;
  startedAt: Date | null;
  doneAt: Date | null;
}

export interface Finding {
  subject: string;
  level: 'high' | 'medium' | 'low' | 'pass' | 'fail';
  conclusion: string;
  evidence: string[];
}

const open = (s: StoryFact) => s.status !== 'done' && s.status !== 'canceled';

export function blockedWork(input: {
  stories: StoryFact[];
  dependencies: { storyId: string; blockerStoryId: string }[];
  openPullRequests: { storyId: string; number: number; openedAt: Date | null }[];
  latestBuildFailed: { commitSha: string } | null;
  now?: Date;
}): Finding[] {
  const now = input.now ?? new Date();
  const byId = new Map(input.stories.map((s) => [s.id, s]));
  const findings: Finding[] = [];
  for (const story of input.stories.filter(open)) {
    const evidence: string[] = [];
    for (const dep of input.dependencies.filter((d) => d.storyId === story.id)) {
      const blocker = byId.get(dep.blockerStoryId);
      if (blocker && open(blocker)) evidence.push(`Blocked by ${blocker.key} ${blocker.title}, which is ${blocker.status.replace('_', ' ')}`);
    }
    for (const pr of input.openPullRequests.filter((p) => p.storyId === story.id)) {
      const days = pr.openedAt ? Math.floor((now.getTime() - pr.openedAt.getTime()) / 86_400_000) : 0;
      if (days >= 5) evidence.push(`Pull request #${pr.number} has been open for ${days} days`);
    }
    if (story.status === 'in_progress' && input.latestBuildFailed) {
      evidence.push(`The latest build for this project failed at ${input.latestBuildFailed.commitSha.slice(0, 12)}`);
    }
    if (evidence.length) findings.push({ subject: story.key, level: evidence.length > 1 ? 'high' : 'medium', conclusion: `${story.key} is blocked`, evidence });
  }
  return findings;
}

export function milestoneRisk(input: { name: string; targetDate: Date; stories: StoryFact[]; doneLast28Days: number; now?: Date }): Finding {
  const now = input.now ?? new Date();
  const remaining = input.stories.filter(open);
  const weeksLeft = Math.max(0, (input.targetDate.getTime() - now.getTime()) / (7 * 86_400_000));
  const throughput = input.doneLast28Days / 4;
  const weeksNeeded = throughput > 0 ? remaining.length / throughput : remaining.length > 0 ? Infinity : 0;
  const level = weeksNeeded > weeksLeft ? 'high' : weeksNeeded > weeksLeft * 0.8 ? 'medium' : 'low';
  return {
    subject: input.name,
    level,
    conclusion: level === 'low' ? `${input.name} is on track` : `${input.name} is at ${level} risk`,
    evidence: [
      `${remaining.length} of ${input.stories.length} stories are not done`,
      `${input.doneLast28Days} stories finished in the last 28 days, about ${Math.round(throughput * 10) / 10} a week`,
      `${Math.round(weeksLeft * 10) / 10} weeks until ${input.targetDate.toISOString().slice(0, 10)}`,
      Number.isFinite(weeksNeeded) ? `At that pace the remaining work needs ${Math.round(weeksNeeded * 10) / 10} weeks` : 'No finished stories yet, so no pace to project',
    ],
  };
}

export function releaseReadiness(input: {
  milestone: string;
  stories: StoryFact[];
  latestStaging: { status: string; version: string } | null;
  openSevereIncidents: { title: string; severity: string }[];
  proposedDecisions: { title: string }[];
}): Finding[] {
  const notDone = input.stories.filter(open);
  return [
    {
      subject: 'Stories done',
      level: notDone.length === 0 ? 'pass' : 'fail',
      conclusion: notDone.length === 0 ? `Every ${input.milestone} story is done` : `${notDone.length} ${input.milestone} stories are not done`,
      evidence: notDone.map((s) => `${s.key} ${s.title} is ${s.status.replace('_', ' ')}`),
    },
    {
      subject: 'Staging',
      level: input.latestStaging?.status === 'succeeded' ? 'pass' : 'fail',
      conclusion: input.latestStaging ? `Latest staging deployment ${input.latestStaging.status}` : 'Nothing has been deployed to staging',
      evidence: input.latestStaging ? [`Version ${input.latestStaging.version.slice(0, 12)}`] : [],
    },
    {
      subject: 'Incidents',
      level: input.openSevereIncidents.length === 0 ? 'pass' : 'fail',
      conclusion: input.openSevereIncidents.length === 0 ? 'No open sev1 or sev2 incidents' : `${input.openSevereIncidents.length} severe incidents are open`,
      evidence: input.openSevereIncidents.map((i) => `${i.severity}: ${i.title}`),
    },
    {
      subject: 'Decisions',
      level: input.proposedDecisions.length === 0 ? 'pass' : 'fail',
      conclusion: input.proposedDecisions.length === 0 ? 'Every architecture decision is accepted' : `${input.proposedDecisions.length} decisions are still proposed`,
      evidence: input.proposedDecisions.map((d) => d.title),
    },
  ];
}
