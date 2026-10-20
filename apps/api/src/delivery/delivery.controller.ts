import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { audit, schema as s } from '@higgsden/db';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, loadProject, parse, uuidParam } from '../common/access.js';
import { ProvidersService } from '../common/providers.service.js';
import { DbService } from '../db/db.service.js';
import { requestProductionDeploy } from './pipeline.js';

@Controller('agencies/:agencyId/projects/:projectId/delivery')
@UseGuards(SessionGuard, TenantGuard)
export class DeliveryController {
  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  overview(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      const environments = await tx.select().from(s.environments).where(eq(s.environments.projectId, project.id));
      const deployments = await tx.select().from(s.deployments).where(eq(s.deployments.projectId, project.id)).orderBy(desc(s.deployments.createdAt)).limit(20);
      const builds = await tx.select().from(s.builds).where(eq(s.builds.projectId, project.id)).orderBy(desc(s.builds.createdAt)).limit(10);
      const previews = await tx.select().from(s.previewThemes).where(eq(s.previewThemes.projectId, project.id)).orderBy(desc(s.previewThemes.createdAt)).limit(10);
      const stores = await tx.select().from(s.storeConnections).where(eq(s.storeConnections.clientId, project.clientId));
      return {
        deliveryType: project.deliveryType,
        providers: { github: this.providers.p.github.mode, shopify: this.providers.p.themes.mode, codebuild: this.providers.p.builds.mode, argocd: this.providers.p.argo.mode },
        stores: stores.map((st) => ({ id: st.id, domain: st.domain, storeRole: st.storeRole })),
        environments: environments.map((e) => ({
          id: e.id,
          name: e.name,
          url: e.url,
          currentVersion: e.currentVersion,
          currentReplicas: e.currentReplicas,
          desiredReplicas: e.desiredReplicas,
          pinnedMaxReplicas: e.pinnedMaxReplicas,
          scaledToZero: e.scaledToZero,
          tierCode: e.tierCode,
        })),
        deployments: deployments.map((d) => ({
          id: d.id,
          environmentId: d.environmentId,
          version: d.version,
          status: d.status,
          createdAt: d.createdAt.toISOString(),
        })),
        builds: builds.map((b) => ({ id: b.id, commitSha: b.commitSha, status: b.status, durationSeconds: b.durationSeconds })),
        previews: previews.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, name: p.name, previewUrl: p.previewUrl, status: p.status })),
      };
    });
  }

  @Post('stores')
  addStore(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(z.object({ domain: z.string().trim().min(3).max(120), storeRole: z.enum(['development', 'staging', 'production']) }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'stores.manage', project.clientId);
      const secretRef = `/${project.agencyId}/${project.clientId}/${input.domain}/theme`;
      await this.providers.p.secrets.put(secretRef, 'dummy-theme-token', { agency: project.agencyId });
      const [row] = await tx.insert(s.storeConnections).values({ agencyId: project.agencyId, clientId: project.clientId, domain: input.domain, storeRole: input.storeRole, secretRef }).returning();
      return { id: row!.id };
    });
  }

  @Post('deployments')
  request(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const { version } = parse(z.object({ version: z.string().min(7) }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'deployments.request', project.clientId);
      const deployment = await requestProductionDeploy(tx, tenant.userId, project, version);
      return { id: deployment.id, status: deployment.status };
    });
  }

  @Post('deployments/:deploymentId/approve')
  approve(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('deploymentId') deploymentId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'releases.approve', project.clientId);
      const [deployment] = await tx.select().from(s.deployments).where(and(eq(s.deployments.id, uuidParam(deploymentId)), eq(s.deployments.projectId, project.id)));
      if (!deployment) throw new NotFoundException();
      if (deployment.status !== 'pending_approval') throw new BadRequestException({ code: 'state', message: `Deployment is ${deployment.status.replace('_', ' ')}.` });
      const [env] = await tx.select().from(s.environments).where(eq(s.environments.id, deployment.environmentId));
      await this.providers.p.argo.sync(env?.argoApplication ?? `${project.key.toLowerCase()}-production`, deployment.version);
      await tx.update(s.deployments).set({ status: 'succeeded', approvedBy: tenant.userId, approvedAt: new Date(), finishedAt: new Date() }).where(eq(s.deployments.id, deployment.id));
      if (env) await tx.update(s.environments).set({ currentVersion: deployment.version }).where(eq(s.environments.id, env.id));
      await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'deployment', entityId: deployment.id, action: 'deployment.approve', summary: `Approved production ${deployment.version.slice(0, 12)}` });
      return { ok: true };
    });
  }

  @Post('deployments/:deploymentId/reject')
  reject(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('deploymentId') deploymentId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'releases.approve', project.clientId);
      await tx.update(s.deployments).set({ status: 'rejected', approvedBy: tenant.userId, approvedAt: new Date() }).where(and(eq(s.deployments.id, uuidParam(deploymentId)), eq(s.deployments.projectId, project.id)));
      return { ok: true };
    });
  }

  @Post('deployments/:deploymentId/rollback')
  rollback(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('deploymentId') deploymentId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'releases.approve', project.clientId);
      const [current] = await tx.select().from(s.deployments).where(and(eq(s.deployments.id, uuidParam(deploymentId)), eq(s.deployments.projectId, project.id)));
      if (!current) throw new NotFoundException();
      const previous = (await tx.select().from(s.deployments).where(and(eq(s.deployments.environmentId, current.environmentId), eq(s.deployments.status, 'succeeded'))).orderBy(desc(s.deployments.createdAt))).find((d) => d.id !== current.id);
      if (!previous) throw new BadRequestException({ message: 'No previous successful deployment to roll back to.' });
      const [row] = await tx
        .insert(s.deployments)
        .values({
          agencyId: project.agencyId,
          clientId: project.clientId,
          projectId: project.id,
          environmentId: current.environmentId,
          version: previous.version,
          status: 'succeeded',
          requestedBy: tenant.userId,
          approvedBy: tenant.userId,
          approvedAt: new Date(),
          rollbackOfId: current.id,
          finishedAt: new Date(),
        })
        .returning();
      await tx.update(s.environments).set({ currentVersion: previous.version }).where(eq(s.environments.id, current.environmentId));
      await tx.update(s.deployments).set({ status: 'rolled_back' }).where(eq(s.deployments.id, current.id));
      await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'deployment', entityId: row!.id, action: 'deployment.rollback', summary: `Rolled back to ${previous.version.slice(0, 12)}` });
      return { id: row!.id };
    });
  }

  @Get('logs')
  logs(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Query('q') q?: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'logs.read', project.clientId);
      const rows = await tx
        .select()
        .from(s.logEntries)
        .where(and(eq(s.logEntries.projectId, project.id), q ? ilike(s.logEntries.message, `%${q}%`) : sql`true`))
        .orderBy(desc(s.logEntries.ts))
        .limit(100);
      return rows.map((r) => ({ id: r.id, source: r.source, level: r.level, message: r.message, ts: r.ts.toISOString() }));
    });
  }
}
