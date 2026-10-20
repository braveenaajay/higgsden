import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import type { ProjectDetail } from '@higgsden/contracts';
import { schema } from '@higgsden/db';
import { allowedActions, canOpenClient } from '@higgsden/policy';
import { asc, count, desc, eq, inArray } from 'drizzle-orm';
import { SessionGuard } from '../auth/session.guard.js';
import { isUuid, type Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { DbService } from '../db/db.service.js';

const s = schema;

@Controller('agencies/:agencyId/projects')
@UseGuards(SessionGuard, TenantGuard)
export class ProjectController {
  constructor(private readonly db: DbService) {}

  @Get(':projectId')
  detail(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string): Promise<ProjectDetail> {
    if (!isUuid(projectId)) throw new NotFoundException();

    return this.db.tenant(tenant, async (tx) => {
      const [project] = await tx
        .select({
          id: s.projects.id,
          key: s.projects.key,
          name: s.projects.name,
          summary: s.projects.summary,
          status: s.projects.status,
          clientId: s.projects.clientId,
          clientName: s.clients.name,
        })
        .from(s.projects)
        .innerJoin(s.clients, eq(s.clients.id, s.projects.clientId))
        .where(eq(s.projects.id, projectId));

      // Row-level security already hides other Agencies. This hides unassigned Clients.
      if (!project || !canOpenClient(tenant, project.clientId)) throw new NotFoundException();

      const [storyTotal] = await tx.select({ n: count() }).from(s.stories).where(eq(s.stories.projectId, projectId));

      const [session] = await tx
        .select()
        .from(s.discoverySessions)
        .where(eq(s.discoverySessions.projectId, projectId))
        .orderBy(desc(s.discoverySessions.version))
        .limit(1);

      const [kpis, requirements] = session
        ? await Promise.all([
            tx.select().from(s.kpis).where(eq(s.kpis.sessionId, session.id)).orderBy(asc(s.kpis.category), asc(s.kpis.createdAt)),
            tx.select().from(s.requirements).where(eq(s.requirements.sessionId, session.id)).orderBy(asc(s.requirements.createdAt)),
          ])
        : [[], []];

      const decisions = await tx
        .select()
        .from(s.architectureDecisions)
        .where(eq(s.architectureDecisions.projectId, projectId))
        .orderBy(asc(s.architectureDecisions.createdAt));

      const epics = await tx.select().from(s.epics).where(eq(s.epics.projectId, projectId)).orderBy(asc(s.epics.createdAt));
      const stories = await tx.select().from(s.stories).where(eq(s.stories.projectId, projectId)).orderBy(asc(s.stories.createdAt));
      const criteria = stories.length
        ? await tx
            .select()
            .from(s.acceptanceCriteria)
            .where(inArray(s.acceptanceCriteria.storyId, stories.map((x) => x.id)))
            .orderBy(asc(s.acceptanceCriteria.position))
        : [];

      const knowledge = await tx
        .select()
        .from(s.knowledgeNotes)
        .where(eq(s.knowledgeNotes.projectId, projectId))
        .orderBy(asc(s.knowledgeNotes.createdAt));

      const activity = await tx
        .select({
          id: s.auditEvents.id,
          action: s.auditEvents.action,
          summary: s.auditEvents.summary,
          actorName: s.users.name,
          createdAt: s.auditEvents.createdAt,
        })
        .from(s.auditEvents)
        .leftJoin(s.users, eq(s.users.id, s.auditEvents.actorId))
        .where(eq(s.auditEvents.projectId, projectId))
        .orderBy(desc(s.auditEvents.createdAt))
        .limit(20);

      const toStory = (story: (typeof stories)[number]) => ({
        id: story.id,
        key: story.key,
        title: story.title,
        status: story.status,
        requirementId: story.requirementId,
        decisionId: story.decisionId,
        acceptanceCriteria: criteria.filter((c) => c.storyId === story.id).map((c) => c.statement),
      });

      const unassigned = stories.filter((x) => !x.epicId);

      return {
        project: { ...project, storyCount: Number(storyTotal?.n ?? 0) },
        allowedActions: allowedActions(tenant, project.clientId),
        discovery: session
          ? {
              id: session.id,
              version: session.version,
              status: session.status,
              recommendation: session.recommendation,
              kpis: kpis.map((k) => ({
                id: k.id,
                name: k.name,
                category: k.category,
                unit: k.unit,
                baseline: k.baseline ?? '',
                target: k.target ?? '',
                source: k.source,
              })),
              requirements: requirements.map((r) => ({
                id: r.id,
                statement: r.statement,
                type: r.type,
                priority: r.priority,
                status: r.status,
              })),
            }
          : null,
        decisions: decisions.map((d) => ({ id: d.id, title: d.title, status: d.status, decision: d.decision })),
        epics: [
          ...epics.map((e) => ({
            id: e.id,
            title: e.title,
            outcome: e.outcome,
            stories: stories.filter((x) => x.epicId === e.id).map(toStory),
          })),
          ...(unassigned.length ? [{ id: 'none', title: 'No epic', outcome: '', stories: unassigned.map(toStory) }] : []),
        ],
        knowledge: knowledge.map((k) => ({ id: k.id, title: k.title, body: k.body, verificationState: k.verificationState })),
        activity: activity.map((a) => ({
          id: a.id,
          action: a.action,
          summary: a.summary,
          actorName: a.actorName ?? 'System',
          createdAt: a.createdAt.toISOString(),
        })),
      };
    });
  }
}
