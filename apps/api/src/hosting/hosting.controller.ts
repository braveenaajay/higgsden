import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { audit, notify, schema as s } from '@higgsden/db';
import { billingPeriod, capReached, computeUsage, periodStart, spendPercent, thresholdsReached } from '@higgsden/domain';
import { desiredReplicasForLoad, nextReplicas, shouldScaleToZero } from '@higgsden/domain';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { BillingArea, CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, parse } from '../common/access.js';
import { DbService } from '../db/db.service.js';

@Controller('agencies/:agencyId/hosting')
@UseGuards(SessionGuard, TenantGuard)
export class HostingController {
  constructor(private readonly db: DbService) {}

  @Get()
  overview(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, async (tx) => {
      const [agency] = await tx.select().from(s.agencies).where(eq(s.agencies.id, tenant.agencyId));
      const tiers = await tx.select().from(s.hostingTiers).orderBy(asc(s.hostingTiers.monthlyPriceCents));
      const environments = await tx
        .select({
          id: s.environments.id,
          name: s.environments.name,
          projectKey: s.projects.key,
          projectId: s.projects.id,
          clientName: s.clients.name,
          tierCode: s.environments.tierCode,
          currentReplicas: s.environments.currentReplicas,
          desiredReplicas: s.environments.desiredReplicas,
          pinnedMaxReplicas: s.environments.pinnedMaxReplicas,
          scaledToZero: s.environments.scaledToZero,
        })
        .from(s.environments)
        .innerJoin(s.projects, eq(s.projects.id, s.environments.projectId))
        .innerJoin(s.clients, eq(s.clients.id, s.environments.clientId));
      const [spend] = await tx
        .select({ cents: sql<string>`coalesce(sum(${s.usageRecords.priceCents}), 0)` })
        .from(s.usageRecords)
        .where(gte(s.usageRecords.recordedAt, periodStart()));
      const usage = await tx.select().from(s.usageRecords).where(gte(s.usageRecords.recordedAt, periodStart())).orderBy(desc(s.usageRecords.recordedAt)).limit(40);
      const spendCents = Math.round(Number(spend?.cents ?? 0));
      const capCents = agency?.spendCapCents ?? 0;
      const [cell] = agency?.cellId ? await tx.select().from(s.cells).where(eq(s.cells.id, agency.cellId)) : [];
      return {
        cell: cell ? { id: cell.id, region: cell.region, status: cell.status, pods: { used: cell.usedPods, max: cell.maxPods }, nodes: { used: cell.usedNodes, max: cell.maxNodes } } : null,
        period: billingPeriod(),
        spendCents,
        capCents,
        percent: spendPercent(spendCents, capCents),
        capReached: capReached(spendCents, capCents),
        tiers: tiers.map((t) => ({ code: t.code, name: t.name, minReplicas: t.minReplicas, maxReplicas: t.maxReplicas, monthlyPriceCents: t.monthlyPriceCents })),
        environments,
        usage: usage.map((u) => ({ id: u.id, meter: u.meter, quantity: u.quantity, priceCents: u.priceCents, recordedAt: u.recordedAt.toISOString() })),
        dummy: true,
      };
    });
  }

  @Patch('spend-cap')
  @BillingArea()
  setCap(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'hosting.manage');
    const { spendCapCents } = parse(z.object({ spendCapCents: z.number().int().min(0).max(100_000_000) }), body);
    return this.db.tenant(tenant, async (tx) => {
      await tx.update(s.agencies).set({ spendCapCents }).where(eq(s.agencies.id, tenant.agencyId));
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'agency', entityId: tenant.agencyId, action: 'hosting.spend_cap', summary: `Set spend cap to ${(spendCapCents / 100).toFixed(0)} USD` });
      return { ok: true };
    });
  }

  /** Dummy load generator. Applies one HPA step and records replica-hour usage. */
  @Post('simulate')
  simulate(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'hosting.manage');
    const { requestsPerSecond, hours } = parse(z.object({ requestsPerSecond: z.number().min(0).max(10_000).default(80), hours: z.number().min(0.1).max(24).default(1) }), body);
    return this.db.tenant(tenant, async (tx) => {
      const [agency] = await tx.select().from(s.agencies).where(eq(s.agencies.id, tenant.agencyId));
      if (!agency) return { ok: false };
      const [spend] = await tx
        .select({ cents: sql<string>`coalesce(sum(${s.usageRecords.priceCents}), 0)` })
        .from(s.usageRecords)
        .where(gte(s.usageRecords.recordedAt, periodStart()));
      const spendCents = Math.round(Number(spend?.cents ?? 0));
      const atCap = capReached(spendCents, agency.spendCapCents);
      const environments = await tx.select().from(s.environments);
      const tiers = Object.fromEntries((await tx.select().from(s.hostingTiers)).map((t) => [t.code, t]));
      let added = 0;
      for (const env of environments) {
        const tier = env.tierCode ? tiers[env.tierCode] : undefined;
        if (!tier) continue;
        const desired = desiredReplicasForLoad(requestsPerSecond);
        const scaledToZero = shouldScaleToZero({ environment: env.name, lastActivityAt: env.lastActivityAt, idleMinutes: tier.previewIdleMinutes });
        const pinned = atCap ? (env.pinnedMaxReplicas ?? env.currentReplicas) : null;
        const next = nextReplicas({
          currentReplicas: env.currentReplicas,
          desiredReplicas: desired,
          minReplicas: tier.minReplicas,
          maxReplicas: tier.maxReplicas,
          pinnedMaxReplicas: pinned,
          scaledToZero,
        });
        await tx.update(s.environments).set({
          desiredReplicas: desired,
          currentReplicas: next,
          pinnedMaxReplicas: pinned,
          scaledToZero,
          lastActivityAt: env.name === 'preview' ? env.lastActivityAt : new Date(),
        }).where(eq(s.environments.id, env.id));
        const usage = computeUsage({
          replicas: next,
          hours,
          replicaHourCostCents: Number(tier.replicaHourCostCents),
          replicaHourPriceCents: Number(tier.replicaHourPriceCents),
        });
        added += usage.priceCents;
        await tx.insert(s.usageRecords).values({
          agencyId: tenant.agencyId,
          projectId: env.projectId,
          environmentId: env.id,
          meter: 'replica_hours',
          unit: 'replica-hour',
          quantity: String(usage.quantity),
          costCents: String(usage.costCents),
          priceCents: String(usage.priceCents),
          sourceId: `${env.id}:${Date.now()}`,
        });
      }
      const newSpend = spendCents + Math.round(added);
      for (const threshold of thresholdsReached(newSpend, agency.spendCapCents)) {
        await tx.insert(s.spendAlerts).values({ agencyId: tenant.agencyId, period: billingPeriod(), threshold, spendCents: newSpend, capCents: agency.spendCapCents }).onConflictDoNothing();
        if (threshold === 80 || threshold === 100) {
          await notify(tx, { agencyId: tenant.agencyId, kind: 'spend', title: `Hosting spend is at ${threshold}% of the cap`, body: `Spend this period is ${(newSpend / 100).toFixed(0)} of ${(agency.spendCapCents / 100).toFixed(0)} USD. Replicas currently serving traffic are not removed.` });
        }
      }
      return { spendCents: newSpend, capCents: agency.spendCapCents, capReached: capReached(newSpend, agency.spendCapCents) };
    });
  }
}
