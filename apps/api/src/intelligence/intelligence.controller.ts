import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { schema as s } from '@higgsden/db';
import { blockedWork, doraMetrics, milestoneRisk, releaseReadiness } from '@higgsden/domain';
import { autonomyVerdict } from '@higgsden/policy';
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, loadProject, parse } from '../common/access.js';
import { DbService } from '../db/db.service.js';

@Controller('agencies/:agencyId/projects/:projectId/insights')
@UseGuards(SessionGuard, TenantGuard)
export class IntelligenceController {
  constructor(private readonly db: DbService) {}

  @Get()
  insights(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Query('days') daysRaw?: string) {
    const windowDays = Math.min(90, Math.max(7, Number(daysRaw ?? 30) || 30));
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'insights.read', project.clientId);
      const since = new Date(Date.now() - windowDays * 86_400_000);
      const environments = await tx.select().from(s.environments).where(eq(s.environments.projectId, project.id));
      const envName = Object.fromEntries(environments.map((e) => [e.id, e.name]));
      const deployments = await tx.select().from(s.deployments).where(and(eq(s.deployments.projectId, project.id), gte(s.deployments.createdAt, since)));
      const incidents = await tx.select().from(s.incidents).where(and(eq(s.incidents.projectId, project.id), gte(s.incidents.openedAt, since)));
      const stories = await tx.select().from(s.stories).where(eq(s.stories.projectId, project.id));
      const dependencies = await tx.select().from(s.storyDependencies).where(eq(s.storyDependencies.projectId, project.id));
      const prs = await tx.select().from(s.pullRequestLinks).where(eq(s.pullRequestLinks.projectId, project.id));
      const [latestBuild] = await tx.select().from(s.builds).where(eq(s.builds.projectId, project.id)).orderBy(desc(s.builds.createdAt)).limit(1);
      const milestones = await tx.select().from(s.milestones).where(eq(s.milestones.projectId, project.id));
      const decisions = await tx.select().from(s.architectureDecisions).where(eq(s.architectureDecisions.projectId, project.id));
      const storyFacts = stories.map((st) => ({ id: st.id, key: st.key, title: st.title, status: st.status, milestoneId: st.milestoneId, startedAt: st.startedAt, doneAt: st.doneAt }));
      const dora = doraMetrics(
        deployments.map((d) => ({
          id: d.id,
          environment: envName[d.environmentId] ?? 'unknown',
          status: d.status,
          createdAt: d.createdAt,
          finishedAt: d.finishedAt,
          changeCommittedAt: d.changeCommittedAt,
          rollbackOfId: d.rollbackOfId,
        })),
        incidents.map((i) => ({ id: i.id, openedAt: i.openedAt, resolvedAt: i.resolvedAt, precedingDeploymentId: i.precedingDeploymentId, fixDeploymentId: i.fixDeploymentId })),
        windowDays,
      );
      const blocked = blockedWork({
        stories: storyFacts,
        dependencies: dependencies.map((d) => ({ storyId: d.storyId, blockerStoryId: d.blockerStoryId })),
        openPullRequests: prs.filter((p) => p.state === 'open').map((p) => ({ storyId: p.storyId, number: p.number, openedAt: p.openedAt })),
        latestBuildFailed: latestBuild?.status === 'failed' ? { commitSha: latestBuild.commitSha } : null,
      });
      const milestoneFindings = milestones.map((m) =>
        milestoneRisk({
          name: m.name,
          targetDate: new Date(m.targetDate),
          stories: storyFacts.filter((st) => st.milestoneId === m.id),
          doneLast28Days: stories.filter((st) => st.doneAt && st.doneAt.getTime() > Date.now() - 28 * 86_400_000).length,
        }),
      );
      const staging = deployments
        .filter((d) => envName[d.environmentId] === 'staging')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const readiness = milestones[0]
        ? releaseReadiness({
            milestone: milestones[0].name,
            stories: storyFacts.filter((st) => st.milestoneId === milestones[0]!.id || !st.milestoneId),
            latestStaging: staging ? { status: staging.status, version: staging.version } : null,
            openSevereIncidents: incidents.filter((i) => i.status !== 'resolved' && (i.severity === 'sev1' || i.severity === 'sev2')).map((i) => ({ title: i.title, severity: i.severity })),
            proposedDecisions: decisions.filter((d) => d.status === 'proposed').map((d) => ({ title: d.title })),
          })
        : [];
      return { windowDays, dora, blocked, milestones: milestoneFindings, readiness };
    });
  }

  @Get('automation')
  automation(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      const rules = await tx.select().from(s.automationRules).where(eq(s.automationRules.projectId, project.id));
      const runs = await tx.select().from(s.automationRuns).where(eq(s.automationRuns.projectId, project.id)).orderBy(desc(s.automationRuns.createdAt)).limit(20);
      const evaluations = await tx.select().from(s.autonomousEvaluations);
      return {
        rules: rules.map((r) => {
          const evalRow = evaluations.find((e) => e.actionCode === r.action);
          const today = runs.filter((run) => run.ruleId === r.id && run.createdAt.getTime() > Date.now() - 86_400_000).length;
          return { ...r, verdict: autonomyVerdict(r.action, evalRow ? { passed: evalRow.passed, score: Number(evalRow.score) } : null, today, r.dailyBudget) };
        }),
        runs,
      };
    });
  }

  @Patch('automation/:ruleId')
  updateRule(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('ruleId') ruleId: string, @Body() body: unknown) {
    const input = parse(z.object({ enabled: z.boolean().optional(), mode: z.enum(['autonomous', 'approval']).optional() }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'automation.manage', project.clientId);
      await tx.update(s.automationRules).set(input).where(eq(s.automationRules.id, ruleId));
      return { ok: true };
    });
  }
}
