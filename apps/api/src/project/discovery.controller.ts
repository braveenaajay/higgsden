import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { APPROACHES, DISCOVERY_SECTIONS, DISCOVERY_TEMPLATE_VERSION, KPI_CATALOG } from '@higgsden/contracts';
import { audit, schema as s, type Tx } from '@higgsden/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, loadProject, parse, uuidParam, type ProjectRow } from '../common/access.js';
import { DbService } from '../db/db.service.js';
import { createStory, reindex } from './stories.js';

type Session = typeof s.discoverySessions.$inferSelect;

const AnswersBody = z.object({
  answers: z.record(z.enum(DISCOVERY_SECTIONS.map((x) => x.id) as [string, ...string[]]), z.string().max(10_000)).optional(),
  recommendation: z.string().max(10_000).optional(),
  approach: z.enum(APPROACHES.map((a) => a.id) as [string, ...string[]]).nullable().optional(),
  reasons: z.string().max(10_000).optional(),
});
const KpiBody = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(['business', 'technical', 'delivery']),
  unit: z.string().max(20).default(''),
  baseline: z.string().regex(/^-?\d+(\.\d+)?$/).or(z.literal('')).default(''),
  target: z.string().regex(/^-?\d+(\.\d+)?$/).or(z.literal('')).default(''),
  source: z.string().max(200).default(''),
  notes: z.string().max(1000).default(''),
});
const ConstraintBody = z.object({ statement: z.string().trim().min(3).max(1000), source: z.string().max(200).default('') });
const RiskBody = z.object({ statement: z.string().trim().min(3).max(1000), impact: z.string().max(1000).default(''), mitigation: z.string().max(1000).default(''), owner: z.string().max(120).default('') });
const RequirementBody = z.object({
  statement: z.string().trim().min(3).max(1000),
  type: z.enum(['functional', 'constraint', 'non_functional']).default('functional'),
  priority: z.enum(['must', 'should', 'could']).default('should'),
  kpiId: z.uuid().nullable().optional(),
});
const ConvertBody = z.object({ requirementIds: z.array(z.uuid()).min(1), epicId: z.uuid().optional(), newEpicTitle: z.string().trim().min(2).max(120).optional() });

const ITEM_TABLES = { kpis: s.kpis, constraints: s.constraints, risks: s.risks, requirements: s.requirements } as const;
type ItemKind = keyof typeof ITEM_TABLES;
const ITEM_BODIES: Record<ItemKind, z.ZodType<Record<string, unknown>>> = { kpis: KpiBody, constraints: ConstraintBody, risks: RiskBody, requirements: RequirementBody };

@Controller('agencies/:agencyId/projects/:projectId/discovery')
@UseGuards(SessionGuard, TenantGuard)
export class DiscoveryController {
  constructor(private readonly db: DbService) {}

  @Get()
  current(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      const versions = await tx
        .select({ id: s.discoverySessions.id, version: s.discoverySessions.version, status: s.discoverySessions.status, acceptedAt: s.discoverySessions.acceptedAt })
        .from(s.discoverySessions)
        .where(eq(s.discoverySessions.projectId, project.id))
        .orderBy(desc(s.discoverySessions.version));
      const latest = versions[0];
      return {
        template: { version: DISCOVERY_TEMPLATE_VERSION, sections: DISCOVERY_SECTIONS, approaches: APPROACHES, kpiCatalog: KPI_CATALOG },
        versions,
        session: latest ? await readSession(tx, latest.id) : null,
      };
    });
  }

  @Get('versions/:version')
  version(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('version') version: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      const [row] = await tx.select().from(s.discoverySessions).where(and(eq(s.discoverySessions.projectId, project.id), eq(s.discoverySessions.version, Number(version))));
      if (!row) throw new NotFoundException();
      return readSession(tx, row.id);
    });
  }

  @Put()
  saveAnswers(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(AnswersBody, body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'discovery.edit', project.clientId);
      const session = await editableSession(tx, tenant, project);
      await tx
        .update(s.discoverySessions)
        .set({
          answers: input.answers ? { ...session.answers, ...input.answers } : session.answers,
          recommendation: input.recommendation ?? session.recommendation,
          approach: (input.approach === undefined ? session.approach : input.approach) as Session['approach'],
          reasons: input.reasons ?? session.reasons,
          updatedAt: new Date(),
        })
        .where(eq(s.discoverySessions.id, session.id));
      return { sessionId: session.id, version: session.version };
    });
  }

  @Post(':kind')
  addItem(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('kind') kind: string, @Body() body: unknown) {
    const k = itemKind(kind);
    const input = parse(ITEM_BODIES[k], body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'discovery.edit', project.clientId);
      const session = await editableSession(tx, tenant, project);
      const values = normalise(k, input);
      const [row] = await tx
        .insert(ITEM_TABLES[k])
        .values({ ...values, agencyId: project.agencyId, clientId: project.clientId, projectId: project.id, sessionId: session.id } as never)
        .returning({ id: ITEM_TABLES[k].id });
      return { id: row!.id, version: session.version };
    });
  }

  @Patch(':kind/:itemId')
  updateItem(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('kind') kind: string, @Param('itemId') itemId: string, @Body() body: unknown) {
    const k = itemKind(kind);
    const input = parse((ITEM_BODIES[k] as z.ZodObject).partial(), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'discovery.edit', project.clientId);
      const session = await editableSession(tx, tenant, project);
      const table = ITEM_TABLES[k];
      const id = await this.mapToSession(tx, k, uuidParam(itemId), session);
      const [row] = await tx.update(table).set(normalise(k, input) as never).where(and(eq(table.id, id), eq(table.sessionId, session.id))).returning({ id: table.id });
      if (!row) throw new NotFoundException();
      return { id: row.id, version: session.version };
    });
  }

  @Delete(':kind/:itemId')
  deleteItem(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('kind') kind: string, @Param('itemId') itemId: string) {
    const k = itemKind(kind);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'discovery.edit', project.clientId);
      const session = await editableSession(tx, tenant, project);
      const table = ITEM_TABLES[k];
      const id = await this.mapToSession(tx, k, uuidParam(itemId), session);
      if (k === 'requirements') {
        const [req] = await tx.select().from(s.requirements).where(eq(s.requirements.id, id));
        if (req && req.status !== 'captured') throw new BadRequestException({ code: 'kept', message: 'Accepted and converted requirements are kept. Reject it instead.' });
      }
      await tx.delete(table).where(and(eq(table.id, id), eq(table.sessionId, session.id)));
      return { ok: true };
    });
  }

  @Post('actions/submit')
  submit(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.transition(tenant, projectId, 'draft', 'in_review', 'discovery.edit');
  }

  @Post('actions/return')
  returnToDraft(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.transition(tenant, projectId, 'in_review', 'draft', 'discovery.edit');
  }

  @Post('actions/accept')
  accept(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.transition(tenant, projectId, 'in_review', 'accepted', 'discovery.accept');
  }

  /** Rejecting keeps the requirement on the session and creates no story. */
  @Post('requirements/:requirementId/reject')
  reject(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('requirementId') requirementId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'discovery.accept', project.clientId);
      const [req] = await tx.select().from(s.requirements).where(and(eq(s.requirements.id, uuidParam(requirementId)), eq(s.requirements.projectId, project.id)));
      if (!req) throw new NotFoundException();
      if (req.status === 'converted') throw new BadRequestException({ code: 'converted', message: 'This requirement already has a story.' });
      await tx.update(s.requirements).set({ status: 'rejected' }).where(eq(s.requirements.id, req.id));
      await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'requirement', entityId: req.id, action: 'requirement.reject', summary: `Rejected requirement: ${req.statement}` });
      return { ok: true };
    });
  }

  /** One accepted requirement becomes one proposed story, docs/phase-1-foundation.md section 6.4. */
  @Post('requirements/convert')
  convert(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(ConvertBody, body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'requirements.convert', project.clientId);
      const reqs = await tx
        .select({ req: s.requirements, sessionStatus: s.discoverySessions.status })
        .from(s.requirements)
        .innerJoin(s.discoverySessions, eq(s.discoverySessions.id, s.requirements.sessionId))
        .where(and(inArray(s.requirements.id, input.requirementIds), eq(s.requirements.projectId, project.id)));
      if (reqs.length !== new Set(input.requirementIds).size) throw new NotFoundException();
      const blocked = reqs.filter((r) => r.req.status !== 'accepted' || r.sessionStatus !== 'accepted');
      if (blocked.length) {
        throw new BadRequestException({ code: 'not_accepted', message: `Only accepted requirements on an accepted discovery can be converted: ${blocked.map((b) => b.req.statement).join('; ')}` });
      }

      let epicId = input.epicId ?? null;
      if (!epicId && input.newEpicTitle) {
        const [epic] = await tx.insert(s.epics).values({ agencyId: project.agencyId, clientId: project.clientId, projectId: project.id, title: input.newEpicTitle }).returning();
        epicId = epic!.id;
      } else if (epicId) {
        const [epic] = await tx.select().from(s.epics).where(and(eq(s.epics.id, epicId), eq(s.epics.projectId, project.id)));
        if (!epic) throw new NotFoundException({ message: 'Unknown epic' });
      }

      const created: { storyId: string; key: string; requirementId: string }[] = [];
      for (const { req } of reqs) {
        const story = await createStory(tx, { userId: tenant.userId }, project, { title: titleFrom(req.statement), description: req.statement, epicId, requirementId: req.id });
        await tx.update(s.requirements).set({ status: 'converted' }).where(eq(s.requirements.id, req.id));
        await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'requirement', entityId: req.id, action: 'requirement.convert', summary: `Converted requirement to ${story.key}: ${req.statement}` });
        created.push({ storyId: story.id, key: story.key, requirementId: req.id });
      }
      return { stories: created };
    });
  }

  private async transition(tenant: Tenant, projectId: string, from: Session['status'], to: Session['status'], action: 'discovery.edit' | 'discovery.accept') {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, action, project.clientId);
      const session = await latestSession(tx, project.id);
      if (session.status !== from) throw new ConflictException({ code: 'state', message: `Discovery is ${session.status.replace('_', ' ')}, not ${from.replace('_', ' ')}.` });
      await tx
        .update(s.discoverySessions)
        .set({ status: to, updatedAt: new Date(), ...(to === 'accepted' ? { acceptedAt: new Date(), acceptedBy: tenant.userId } : {}) })
        .where(eq(s.discoverySessions.id, session.id));
      if (to === 'accepted') {
        await tx.update(s.requirements).set({ status: 'accepted' }).where(and(eq(s.requirements.sessionId, session.id), eq(s.requirements.status, 'captured')));
        if (!project.deliveryType && session.approach) {
          await tx.update(s.projects).set({ deliveryType: session.approach === 'theme' ? 'theme' : 'app' }).where(eq(s.projects.id, project.id));
        }
        const reqs = await tx.select({ id: s.requirements.id }).from(s.requirements).where(eq(s.requirements.sessionId, session.id));
        for (const r of reqs) await reindex(tx, project.agencyId, 'requirement', r.id);
      }
      await audit(tx, {
        agencyId: project.agencyId,
        actorId: tenant.userId,
        clientId: project.clientId,
        projectId: project.id,
        entityType: 'discovery_session',
        entityId: session.id,
        action: to === 'accepted' ? 'discovery.accept' : to === 'in_review' ? 'discovery.submit' : 'discovery.return',
        summary: to === 'accepted' ? `Accepted discovery version ${session.version}` : to === 'in_review' ? `Sent discovery version ${session.version} for review` : `Returned discovery version ${session.version} to draft`,
      });
      return { status: to, version: session.version };
    });
  }

  /** When an edit opens a new draft, item ids from the accepted version resolve to their copies. */
  private async mapToSession(tx: Tx, kind: ItemKind, itemId: string, session: Session): Promise<string> {
    const table = ITEM_TABLES[kind];
    const [row] = await tx.select().from(table).where(eq(table.id, itemId));
    if (!row) throw new NotFoundException();
    if (row.sessionId === session.id) return row.id;
    const [copy] = await tx.select({ id: table.id }).from(table).where(and(eq(table.sessionId, session.id), eq(table.copiedFromId, row.id)));
    if (!copy) throw new NotFoundException();
    return copy.id;
  }
}

function itemKind(kind: string): ItemKind {
  if (!(kind in ITEM_TABLES)) throw new NotFoundException();
  return kind as ItemKind;
}

function normalise(kind: ItemKind, input: Record<string, unknown>) {
  if (kind !== 'kpis') return input;
  const out = { ...input };
  if ('baseline' in out) out.baseline = out.baseline || null;
  if ('target' in out) out.target = out.target || null;
  return out;
}

function titleFrom(statement: string): string {
  const t = statement.replace(/\.$/, '');
  return t.length > 90 ? `${t.slice(0, 87)}...` : t;
}

async function latestSession(tx: Tx, projectId: string): Promise<Session> {
  const [session] = await tx.select().from(s.discoverySessions).where(eq(s.discoverySessions.projectId, projectId)).orderBy(desc(s.discoverySessions.version)).limit(1);
  if (!session) throw new NotFoundException();
  return session;
}

/** Accepted versions are frozen. Editing one opens the next version as a draft copy. */
async function editableSession(tx: Tx, tenant: Tenant, project: ProjectRow): Promise<Session> {
  const session = await latestSession(tx, project.id);
  if (session.status !== 'accepted') return session;

  const [next] = await tx
    .insert(s.discoverySessions)
    .values({
      agencyId: project.agencyId,
      clientId: project.clientId,
      projectId: project.id,
      version: session.version + 1,
      answers: session.answers,
      recommendation: session.recommendation,
      approach: session.approach,
      reasons: session.reasons,
    })
    .returning();
  const scope = { agencyId: project.agencyId, clientId: project.clientId, projectId: project.id, sessionId: next!.id };
  const kpiMap = new Map<string, string>();
  for (const k of await tx.select().from(s.kpis).where(eq(s.kpis.sessionId, session.id))) {
    const { id, sessionId: _s, copiedFromId: _c, ...rest } = k;
    const [copy] = await tx.insert(s.kpis).values({ ...rest, ...scope, copiedFromId: id }).returning();
    kpiMap.set(id, copy!.id);
  }
  for (const c of await tx.select().from(s.constraints).where(eq(s.constraints.sessionId, session.id))) {
    const { id, sessionId: _s, copiedFromId: _c, ...rest } = c;
    await tx.insert(s.constraints).values({ ...rest, ...scope, copiedFromId: id });
  }
  for (const r of await tx.select().from(s.risks).where(eq(s.risks.sessionId, session.id))) {
    const { id, sessionId: _s, copiedFromId: _c, ...rest } = r;
    await tx.insert(s.risks).values({ ...rest, ...scope, copiedFromId: id });
  }
  for (const r of await tx.select().from(s.requirements).where(eq(s.requirements.sessionId, session.id))) {
    const { id, sessionId: _s, copiedFromId: _c, tsv: _t, kpiId, ...rest } = r;
    await tx.insert(s.requirements).values({ ...rest, ...scope, copiedFromId: id, kpiId: kpiId ? (kpiMap.get(kpiId) ?? null) : null });
  }
  await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'discovery_session', entityId: next!.id, action: 'discovery.new_version', summary: `Opened discovery version ${next!.version} as a draft` });
  return next!;
}

async function readSession(tx: Tx, sessionId: string) {
  const [session] = await tx.select().from(s.discoverySessions).where(eq(s.discoverySessions.id, sessionId));
  if (!session) throw new NotFoundException();
  const [kpis, constraints, risks, requirements] = await Promise.all([
    tx.select().from(s.kpis).where(eq(s.kpis.sessionId, sessionId)).orderBy(asc(s.kpis.category), asc(s.kpis.createdAt)),
    tx.select().from(s.constraints).where(eq(s.constraints.sessionId, sessionId)).orderBy(asc(s.constraints.createdAt)),
    tx.select().from(s.risks).where(eq(s.risks.sessionId, sessionId)).orderBy(asc(s.risks.createdAt)),
    tx.select().from(s.requirements).where(eq(s.requirements.sessionId, sessionId)).orderBy(asc(s.requirements.createdAt)),
  ]);
  const reqIds = requirements.map((r) => r.id);
  const stories = reqIds.length
    ? await tx.select({ id: s.stories.id, key: s.stories.key, requirementId: s.stories.requirementId }).from(s.stories).where(inArray(s.stories.requirementId, reqIds))
    : [];
  return {
    id: session.id,
    version: session.version,
    templateVersion: session.templateVersion,
    status: session.status,
    answers: session.answers,
    recommendation: session.recommendation,
    approach: session.approach,
    reasons: session.reasons,
    acceptedAt: session.acceptedAt?.toISOString() ?? null,
    kpis: kpis.map((k) => ({ id: k.id, name: k.name, category: k.category, unit: k.unit, baseline: k.baseline ?? '', target: k.target ?? '', source: k.source, notes: k.notes })),
    constraints: constraints.map((c) => ({ id: c.id, statement: c.statement, source: c.source })),
    risks: risks.map((r) => ({ id: r.id, statement: r.statement, impact: r.impact, mitigation: r.mitigation, owner: r.owner })),
    requirements: requirements.map((r) => ({
      id: r.id,
      statement: r.statement,
      type: r.type,
      priority: r.priority,
      status: r.status,
      kpiId: r.kpiId,
      stories: stories.filter((st) => st.requirementId === r.id).map((st) => ({ id: st.id, key: st.key })),
    })),
  };
}
