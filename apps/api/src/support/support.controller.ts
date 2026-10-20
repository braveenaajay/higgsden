import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { audit, schema as s } from '@higgsden/db';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { OperatorGuard, SessionGuard } from '../auth/session.guard.js';
import type { SessionUser, Tenant } from '../auth/session.js';
import { CurrentTenant, CurrentUser, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, parse, uuidParam } from '../common/access.js';
import { DbService } from '../db/db.service.js';

const RequestBody = z.object({ subject: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(10_000) });
const ReplyBody = z.object({ body: z.string().trim().min(1).max(10_000) });

/** Platform support: a member asks the HiggsDEN operators for help. Nothing is attached automatically. */
@Controller('agencies/:agencyId/support')
@UseGuards(SessionGuard, TenantGuard)
export class SupportController {
  constructor(private readonly db: DbService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, (tx) =>
      tx
        .select({ id: s.supportRequests.id, subject: s.supportRequests.subject, status: s.supportRequests.status, authorName: s.users.name, createdAt: s.supportRequests.createdAt, updatedAt: s.supportRequests.updatedAt })
        .from(s.supportRequests)
        .leftJoin(s.users, eq(s.users.id, s.supportRequests.authorId))
        .orderBy(desc(s.supportRequests.updatedAt)),
    );
  }

  @Post()
  create(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'support.submit');
    const input = parse(RequestBody, body);
    return this.db.tenant(tenant, async (tx) => {
      const [row] = await tx.insert(s.supportRequests).values({ agencyId: tenant.agencyId, authorId: tenant.userId, ...input }).returning();
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'support_request', entityId: row!.id, action: 'support.create', summary: `Opened support request: ${input.subject}` });
      return { id: row!.id };
    });
  }

  @Get(':requestId')
  detail(@CurrentTenant() tenant: Tenant, @Param('requestId') requestId: string) {
    return this.db.tenant(tenant, (tx) => readRequest(tx, uuidParam(requestId)));
  }

  @Post(':requestId/replies')
  reply(@CurrentTenant() tenant: Tenant, @Param('requestId') requestId: string, @Body() body: unknown) {
    const input = parse(ReplyBody, body);
    return this.db.tenant(tenant, async (tx) => {
      const request = await readRequest(tx, uuidParam(requestId));
      if (request.status === 'closed') throw new BadRequestException({ code: 'closed', message: 'This request is closed.' });
      await tx.insert(s.supportReplies).values({ agencyId: tenant.agencyId, requestId: request.id, authorId: tenant.userId, body: input.body });
      await tx.update(s.supportRequests).set({ status: 'open', updatedAt: new Date() }).where(eq(s.supportRequests.id, request.id));
      return { ok: true };
    });
  }

  @Post(':requestId/close')
  close(@CurrentTenant() tenant: Tenant, @Param('requestId') requestId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const request = await readRequest(tx, uuidParam(requestId));
      await tx.update(s.supportRequests).set({ status: 'closed', updatedAt: new Date() }).where(eq(s.supportRequests.id, request.id));
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'support_request', entityId: request.id, action: 'support.close', summary: `Closed support request: ${request.subject}` });
      return { ok: true };
    });
  }
}

type AnyTx = Parameters<Parameters<DbService['db']['transaction']>[0]>[0];

async function readRequest(tx: AnyTx, requestId: string) {
  const [request] = await tx.select().from(s.supportRequests).where(eq(s.supportRequests.id, requestId));
  if (!request) throw new NotFoundException();
  const replies = await tx
    .select({ id: s.supportReplies.id, body: s.supportReplies.body, fromOperator: s.supportReplies.fromOperator, authorName: s.users.name, createdAt: s.supportReplies.createdAt })
    .from(s.supportReplies)
    .leftJoin(s.users, eq(s.users.id, s.supportReplies.authorId))
    .where(eq(s.supportReplies.requestId, requestId))
    .orderBy(asc(s.supportReplies.createdAt));
  return { ...request, replies };
}

const ArticleBody = z.object({ title: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(20_000) });

/**
 * The operator console. Every query runs as the higgsden_operator database role, which can read Agencies, plans,
 * support, and cost data and has no grant on stories, discovery, code, or knowledge.
 */
@Controller('ops')
@UseGuards(SessionGuard, OperatorGuard)
export class OperatorController {
  constructor(private readonly db: DbService) {}

  @Get('agencies')
  async agencies() {
    const rows = await this.db.operator.select().from(s.agencies).innerJoin(s.plans, eq(s.plans.code, s.agencies.planCode)).orderBy(asc(s.agencies.name));
    const overview = await this.db.operator.execute<{
      agency_id: string;
      members: string;
      pending_invites: string;
      clients: string;
      projects: string;
      teams_connected: boolean;
    }>(sql`select * from operator_agency_overview()`);
    const counts = new Map(overview.rows.map((r) => [r.agency_id, r]));
    return rows.map(({ agencies: a, plans: p }) => ({
      id: a.id,
      name: a.name,
      plan: p.name,
      subscriptionState: a.subscriptionState,
      trialEndsAt: a.trialEndsAt,
      spendCapCents: a.spendCapCents,
      cellId: a.cellId,
      seats: { used: Number(counts.get(a.id)?.members ?? 0) + Number(counts.get(a.id)?.pending_invites ?? 0), cap: p.seatCap },
      clients: { used: Number(counts.get(a.id)?.clients ?? 0), cap: p.clientCap },
      projects: Number(counts.get(a.id)?.projects ?? 0),
      teamsConnected: Boolean(counts.get(a.id)?.teams_connected),
    }));
  }

  @Get('plans')
  plans() {
    return this.db.operator.select().from(s.plans).orderBy(asc(s.plans.monthlyPriceCents));
  }

  @Get('support')
  support() {
    return this.db.operator
      .select({ id: s.supportRequests.id, agencyName: s.agencies.name, subject: s.supportRequests.subject, status: s.supportRequests.status, createdAt: s.supportRequests.createdAt, updatedAt: s.supportRequests.updatedAt })
      .from(s.supportRequests)
      .innerJoin(s.agencies, eq(s.agencies.id, s.supportRequests.agencyId))
      .orderBy(desc(s.supportRequests.updatedAt));
  }

  @Get('support/:requestId')
  async supportDetail(@Param('requestId') requestId: string) {
    return this.db.operator.transaction(async (tx) => {
      const detail = await readRequest(tx, uuidParam(requestId));
      const [agency] = await tx.select({ name: s.agencies.name }).from(s.agencies).where(eq(s.agencies.id, detail.agencyId));
      return { ...detail, agencyName: agency?.name ?? '' };
    });
  }

  @Post('support/:requestId/replies')
  operatorReply(@CurrentUser() user: SessionUser, @Param('requestId') requestId: string, @Body() body: unknown) {
    const input = parse(ReplyBody, body);
    return this.db.operator.transaction(async (tx) => {
      const request = await readRequest(tx, uuidParam(requestId));
      await tx.insert(s.supportReplies).values({ agencyId: request.agencyId, requestId: request.id, authorId: user.id, fromOperator: true, body: input.body });
      await tx.update(s.supportRequests).set({ status: 'answered', updatedAt: new Date() }).where(eq(s.supportRequests.id, request.id));
      return { ok: true };
    });
  }

  /** Cost against revenue per Agency and per tier, from the daily Cost and Usage Report load. */
  @Get('costs')
  async costs() {
    const rows = await this.db.operator
      .select({ agencyId: s.costReports.agencyId, agencyName: s.agencies.name, costCents: sql<string>`sum(${s.costReports.costCents})`, revenueCents: sql<string>`sum(${s.costReports.revenueCents})` })
      .from(s.costReports)
      .innerJoin(s.agencies, eq(s.agencies.id, s.costReports.agencyId))
      .where(sql`${s.costReports.day} >= current_date - 30`)
      .groupBy(s.costReports.agencyId, s.agencies.name);
    const tierRows = await this.db.operator.select({ byTier: s.costReports.byTier }).from(s.costReports).where(sql`${s.costReports.day} >= current_date - 30`);
    const byTier: Record<string, { costCents: number; revenueCents: number }> = {};
    for (const r of tierRows) {
      for (const [tier, v] of Object.entries(r.byTier)) {
        byTier[tier] ??= { costCents: 0, revenueCents: 0 };
        byTier[tier].costCents += v.costCents;
        byTier[tier].revenueCents += v.revenueCents;
      }
    }
    return {
      windowDays: 30,
      agencies: rows.map((r) => {
        const cost = Number(r.costCents);
        const revenue = Number(r.revenueCents);
        return { agencyId: r.agencyId, agencyName: r.agencyName, costCents: cost, revenueCents: revenue, marginPercent: revenue ? Math.round(((revenue - cost) / revenue) * 100) : null };
      }),
      tiers: Object.entries(byTier).map(([tier, v]) => ({ tier, ...v, marginPercent: v.revenueCents ? Math.round(((v.revenueCents - v.costCents) / v.revenueCents) * 100) : null })),
    };
  }

  /** Cell capacity against the 70% planning threshold. */
  @Get('capacity')
  async capacity() {
    const cells = await this.db.operator.select().from(s.cells);
    const pools = await this.db.operator.select().from(s.dbInstances).orderBy(asc(s.dbInstances.identifier));
    const pct = (used: number, max: number) => Math.round((used / max) * 100);
    return {
      threshold: 70,
      cells: cells.map((c) => ({ id: c.id, region: c.region, pods: pct(c.usedPods, c.maxPods), nodes: pct(c.usedNodes, c.maxNodes), ips: pct(c.usedIps, c.maxIps) })),
      databasePools: pools.map((p) => ({ identifier: p.identifier, cellId: p.cellId, envClass: p.envClass, databases: p.databaseCount, max: p.maxDatabases, percent: pct(p.databaseCount, p.maxDatabases) })),
    };
  }

  @Get('alerts')
  alerts() {
    return this.db.operator.select().from(s.operatorAlerts).orderBy(desc(s.operatorAlerts.createdAt)).limit(50);
  }

  @Post('alerts/:alertId/ack')
  async ack(@Param('alertId') alertId: string) {
    await this.db.operator.update(s.operatorAlerts).set({ acknowledgedAt: new Date() }).where(eq(s.operatorAlerts.id, uuidParam(alertId)));
    return { ok: true };
  }

  @Get('evaluations')
  evaluations() {
    return this.db.operator.select().from(s.autonomousEvaluations).orderBy(desc(s.autonomousEvaluations.ranAt));
  }

  // --- Platform knowledge base: written and reviewed by operators, readable by every Agency's retrieval --------

  @Get('articles')
  articles() {
    return this.db.operator.select().from(s.platformArticles).orderBy(desc(s.platformArticles.updatedAt));
  }

  @Post('articles')
  async createArticle(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const input = parse(ArticleBody, body);
    const [row] = await this.db.operator.insert(s.platformArticles).values({ ...input, authorId: user.id }).returning();
    return { id: row!.id };
  }

  @Patch('articles/:articleId')
  async updateArticle(@CurrentUser() user: SessionUser, @Param('articleId') articleId: string, @Body() body: unknown) {
    const input = parse(ArticleBody.partial().extend({ status: z.enum(['draft', 'in_review', 'published', 'archived']).optional() }), body);
    return this.db.operator.transaction(async (tx) => {
      const [article] = await tx.select().from(s.platformArticles).where(eq(s.platformArticles.id, uuidParam(articleId)));
      if (!article) throw new NotFoundException();
      if (input.status === 'published' && article.authorId === user.id) {
        throw new BadRequestException({ code: 'review', message: 'Another operator must review and publish this article.' });
      }
      await tx
        .update(s.platformArticles)
        .set({ ...input, updatedAt: new Date(), reviewerId: input.status === 'published' ? user.id : article.reviewerId })
        .where(eq(s.platformArticles.id, article.id));
      // Published articles are re-chunked. The worker embeds chunks that have no vector.
      await tx.delete(s.platformChunks).where(eq(s.platformChunks.articleId, article.id));
      if ((input.status ?? article.status) === 'published') {
        await tx.insert(s.platformChunks).values({ articleId: article.id, title: input.title ?? article.title, content: input.body ?? article.body, position: 0 });
      }
      return { ok: true };
    });
  }
}
