import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { schema as s, type Tx } from '@higgsden/db';
import { allowedActions } from '@higgsden/policy';
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, loadProject, parse, uuidParam } from '../common/access.js';
import { DbService } from '../db/db.service.js';

@Controller('agencies/:agencyId/projects')
@UseGuards(SessionGuard, TenantGuard)
export class ProjectController {
  constructor(private readonly db: DbService) {}

  @Get(':projectId')
  detail(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      const [client] = await tx.select({ name: s.clients.name }).from(s.clients).where(eq(s.clients.id, project.clientId));
      const [storyTotal] = await tx.select({ n: count() }).from(s.stories).where(eq(s.stories.projectId, project.id));
      const [session] = await tx.select().from(s.discoverySessions).where(eq(s.discoverySessions.projectId, project.id)).orderBy(desc(s.discoverySessions.version)).limit(1);
      const [kpis, constraints, risks, requirements] = session
        ? await Promise.all([
            tx.select().from(s.kpis).where(eq(s.kpis.sessionId, session.id)).orderBy(asc(s.kpis.createdAt)),
            tx.select().from(s.constraints).where(eq(s.constraints.sessionId, session.id)),
            tx.select().from(s.risks).where(eq(s.risks.sessionId, session.id)),
            tx.select().from(s.requirements).where(eq(s.requirements.sessionId, session.id)).orderBy(asc(s.requirements.createdAt)),
          ])
        : [[], [], [], []];
      const decisions = await tx.select().from(s.architectureDecisions).where(eq(s.architectureDecisions.projectId, project.id)).orderBy(asc(s.architectureDecisions.createdAt));
      const epics = await tx.select().from(s.epics).where(eq(s.epics.projectId, project.id)).orderBy(asc(s.epics.createdAt));
      const stories = await tx.select().from(s.stories).where(eq(s.stories.projectId, project.id)).orderBy(asc(s.stories.createdAt));
      const criteria = stories.length
        ? await tx.select().from(s.acceptanceCriteria).where(inArray(s.acceptanceCriteria.storyId, stories.map((x) => x.id))).orderBy(asc(s.acceptanceCriteria.position))
        : [];
      const prs = stories.length
        ? await tx.select().from(s.pullRequestLinks).where(inArray(s.pullRequestLinks.storyId, stories.map((x) => x.id)))
        : [];
      const knowledge = await tx.select().from(s.knowledgeNotes).where(eq(s.knowledgeNotes.projectId, project.id)).orderBy(asc(s.knowledgeNotes.createdAt));
      const activity = await tx
        .select({ id: s.auditEvents.id, action: s.auditEvents.action, summary: s.auditEvents.summary, actorName: s.users.name, createdAt: s.auditEvents.createdAt })
        .from(s.auditEvents)
        .leftJoin(s.users, eq(s.users.id, s.auditEvents.actorId))
        .where(eq(s.auditEvents.projectId, project.id))
        .orderBy(desc(s.auditEvents.createdAt))
        .limit(30);
      const environments = await tx.select().from(s.environments).where(eq(s.environments.projectId, project.id));
      const resources = await tx.select().from(s.provisionedResources).where(eq(s.provisionedResources.projectId, project.id)).orderBy(asc(s.provisionedResources.kind));
      const toStory = (story: (typeof stories)[number]) => ({
        id: story.id,
        key: story.key,
        title: story.title,
        description: story.description,
        status: story.status,
        requirementId: story.requirementId,
        decisionId: story.decisionId,
        acceptanceCriteria: criteria.filter((c) => c.storyId === story.id).map((c) => c.statement),
        pullRequests: prs.filter((p) => p.storyId === story.id).map((p) => ({ id: p.id, number: p.number, url: p.url, title: p.title, state: p.state })),
      });
      const unassigned = stories.filter((x) => !x.epicId);
      return {
        project: {
          id: project.id,
          key: project.key,
          name: project.name,
          summary: project.summary,
          status: project.status,
          deliveryType: project.deliveryType,
          clientId: project.clientId,
          clientName: client?.name ?? '',
          storyCount: Number(storyTotal?.n ?? 0),
        },
        allowedActions: allowedActions(tenant, project.clientId),
        discovery: session
          ? {
              id: session.id,
              version: session.version,
              status: session.status,
              recommendation: session.recommendation,
              approach: session.approach,
              kpis: kpis.map((k) => ({ id: k.id, name: k.name, category: k.category, unit: k.unit, baseline: k.baseline ?? '', target: k.target ?? '', source: k.source })),
              constraints: constraints.map((c) => ({ id: c.id, statement: c.statement })),
              risks: risks.map((r) => ({ id: r.id, statement: r.statement, impact: r.impact, mitigation: r.mitigation })),
              requirements: requirements.map((r) => ({ id: r.id, statement: r.statement, type: r.type, priority: r.priority, status: r.status })),
            }
          : null,
        decisions: decisions.map((d) => ({ id: d.id, title: d.title, status: d.status, decision: d.decision, context: d.context })),
        epics: [
          ...epics.map((e) => ({ id: e.id, title: e.title, outcome: e.outcome, stories: stories.filter((x) => x.epicId === e.id).map(toStory) })),
          ...(unassigned.length ? [{ id: 'none', title: 'No epic', outcome: '', stories: unassigned.map(toStory) }] : []),
        ],
        knowledge: knowledge.map((k) => ({ id: k.id, title: k.title, body: k.body, verificationState: k.verificationState })),
        activity: activity.map((a) => ({ ...a, actorName: a.actorName ?? 'System', createdAt: a.createdAt.toISOString() })),
        environments: environments.map((e) => ({
          id: e.id,
          name: e.name,
          url: e.url,
          currentVersion: e.currentVersion,
          currentReplicas: e.currentReplicas,
          desiredReplicas: e.desiredReplicas,
          pinnedMaxReplicas: e.pinnedMaxReplicas,
          tierCode: e.tierCode,
        })),
        resources: resources.map((r) => ({ id: r.id, kind: r.kind, name: r.name, status: r.status, tags: r.tags })),
      };
    });
  }

  @Get(':projectId/search')
  search(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Query('q') q?: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) return { results: [] as { scope: string; title: string; snippet: string; href: string }[] };
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      return { results: await searchProject(tx, tenant, project.id, project.clientId, query) };
    });
  }
}

@Controller('agencies/:agencyId/projects/:projectId/decisions')
@UseGuards(SessionGuard, TenantGuard)
export class DecisionController {
  constructor(private readonly db: DbService) {}

  @Post()
  create(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(z.object({ title: z.string().trim().min(3).max(160), context: z.string().max(4000).default(''), decision: z.string().trim().min(3).max(4000), consequences: z.string().max(4000).default('') }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'decisions.propose', project.clientId);
      const [row] = await tx.insert(s.architectureDecisions).values({ agencyId: project.agencyId, clientId: project.clientId, projectId: project.id, ...input }).returning();
      return { id: row!.id };
    });
  }

  @Post(':decisionId/accept')
  accept(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('decisionId') decisionId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'decisions.accept', project.clientId);
      const [row] = await tx.update(s.architectureDecisions).set({ status: 'accepted', acceptedBy: tenant.userId }).where(and(eq(s.architectureDecisions.id, uuidParam(decisionId)), eq(s.architectureDecisions.projectId, project.id))).returning();
      if (!row) throw new NotFoundException();
      return { ok: true };
    });
  }
}

@Controller('agencies/:agencyId/projects/:projectId/knowledge')
@UseGuards(SessionGuard, TenantGuard)
export class KnowledgeController {
  constructor(private readonly db: DbService) {}

  @Post()
  create(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(20_000) }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'knowledge.write', project.clientId);
      const [row] = await tx.insert(s.knowledgeNotes).values({ agencyId: project.agencyId, clientId: project.clientId, projectId: project.id, authorId: tenant.userId, ...input }).returning();
      return { id: row!.id };
    });
  }

  @Patch(':noteId')
  verify(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('noteId') noteId: string, @Body() body: unknown) {
    const input = parse(z.object({ verificationState: z.enum(['proposed', 'reviewed', 'verified', 'stale', 'superseded']) }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, input.verificationState === 'verified' ? 'knowledge.verify' : 'knowledge.write', project.clientId);
      await tx.update(s.knowledgeNotes).set({ verificationState: input.verificationState, updatedAt: new Date() }).where(and(eq(s.knowledgeNotes.id, uuidParam(noteId)), eq(s.knowledgeNotes.projectId, project.id)));
      return { ok: true };
    });
  }
}

async function searchProject(tx: Tx, tenant: Tenant, projectId: string, clientId: string, q: string) {
  const ts = sql`plainto_tsquery('english', ${q})`;
  const notes = await tx
    .select({ id: s.knowledgeNotes.id, title: s.knowledgeNotes.title, body: s.knowledgeNotes.body })
    .from(s.knowledgeNotes)
    .where(and(eq(s.knowledgeNotes.projectId, projectId), sql`${s.knowledgeNotes.tsv} @@ ${ts}`))
    .limit(8);
  const stories = await tx
    .select({ id: s.stories.id, key: s.stories.key, title: s.stories.title, description: s.stories.description })
    .from(s.stories)
    .where(and(eq(s.stories.projectId, projectId), sql`${s.stories.tsv} @@ ${ts}`))
    .limit(8);
  const platform = await tx
    .select({ id: s.platformArticles.id, title: s.platformArticles.title, body: s.platformArticles.body })
    .from(s.platformArticles)
    .innerJoin(s.platformChunks, eq(s.platformChunks.articleId, s.platformArticles.id))
    .where(and(eq(s.platformArticles.status, 'published'), sql`${s.platformChunks.tsv} @@ ${ts}`))
    .limit(4);
  void tenant;
  void clientId;
  return [
    ...notes.map((n) => ({ scope: 'agency', title: n.title, snippet: n.body.slice(0, 180), href: `#knowledge-${n.id}` })),
    ...stories.map((srow) => ({ scope: 'agency', title: `${srow.key} ${srow.title}`, snippet: srow.description.slice(0, 180), href: `#story-${srow.id}` })),
    ...platform.map((p) => ({ scope: 'platform', title: p.title, snippet: p.body.slice(0, 180), href: `#platform-${p.id}` })),
  ];
}
