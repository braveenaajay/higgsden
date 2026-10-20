import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { audit, schema as s } from '@higgsden/db';
import { RESOURCE_KINDS } from '@higgsden/integrations';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, loadProject, parse } from '../common/access.js';
import { ProvidersService } from '../common/providers.service.js';
import { DbService } from '../db/db.service.js';

@Controller('agencies/:agencyId/projects/:projectId/provisioning')
@UseGuards(SessionGuard, TenantGuard)
export class ProvisionController {
  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  status(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      const templates = await tx.select().from(s.templates);
      const resources = await tx.select().from(s.provisionedResources).where(eq(s.provisionedResources.projectId, project.id));
      const environments = await tx.select().from(s.environments).where(eq(s.environments.projectId, project.id));
      return {
        templateCode: project.templateCode,
        templates: templates.map((t) => ({ code: t.code, kind: t.kind, name: t.name, description: t.description })),
        resources: resources.map((r) => ({ id: r.id, kind: r.kind, name: r.name, status: r.status, externalId: r.externalId, tags: r.tags })),
        environments: environments.map((e) => ({ id: e.id, name: e.name, url: e.url, status: e.currentVersion ? 'ready' : 'pending' })),
        dummy: this.providers.p.infra.mode === 'fake',
      };
    });
  }

  @Post()
  run(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(z.object({ templateCode: z.string().optional(), environment: z.enum(['preview', 'staging', 'production']).default('staging') }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'provisioning.run', project.clientId);
      const [agency] = await tx.select().from(s.agencies).where(eq(s.agencies.id, project.agencyId));
      const nameBase = `${project.key.toLowerCase()}-${input.environment}`;
      const tags = { 'higgsden:agency': project.agencyId, 'higgsden:client': project.clientId, 'higgsden:project': project.id };
      const created: { kind: string; name: string; status: string }[] = [];
      for (const kind of RESOURCE_KINDS) {
        const name = `${nameBase}-${kind.replaceAll('_', '-')}`;
        const [row] = await tx
          .insert(s.provisionedResources)
          .values({ agencyId: project.agencyId, projectId: project.id, kind, name, status: 'creating', tags })
          .onConflictDoNothing()
          .returning();
        const resource = row ?? (await tx.select().from(s.provisionedResources).where(eq(s.provisionedResources.name, name)))[0];
        if (!resource) continue;
        const ensured = await this.providers.p.infra.ensure({ kind, name, tags, spec: { environment: input.environment, project: project.key } });
        await tx.update(s.provisionedResources).set({ status: 'ready', externalId: ensured.externalId, details: ensured.details, updatedAt: new Date() }).where(eq(s.provisionedResources.id, resource.id));
        created.push({ kind, name, status: 'ready' });
      }
      const [existing] = (await tx.select().from(s.environments).where(eq(s.environments.projectId, project.id))).filter((e) => e.name === input.environment);
      if (!existing) {
        await tx.insert(s.environments).values({
          agencyId: project.agencyId,
          clientId: project.clientId,
          projectId: project.id,
          name: input.environment,
          url: `https://${nameBase}.${agency?.slug ?? 'demo'}.hosted.higgsden.test`,
          namespace: `${agency?.slug ?? 'demo'}-${nameBase}`,
          argoApplication: nameBase,
          tierCode: input.environment === 'production' ? 'standard' : 'starter',
          currentReplicas: 1,
          desiredReplicas: 1,
        });
      }
      if (input.templateCode) await tx.update(s.projects).set({ templateCode: input.templateCode }).where(eq(s.projects.id, project.id));
      await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'project', entityId: project.id, action: 'provisioning.run', summary: `Provisioned dummy ${input.environment} resources for ${project.key}` });
      return { resources: created };
    });
  }

  @Post('deprovision')
  deprovision(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'provisioning.deprovision', project.clientId);
      const resources = await tx.select().from(s.provisionedResources).where(eq(s.provisionedResources.projectId, project.id));
      for (const r of resources) {
        await this.providers.p.infra.remove(r.kind as (typeof RESOURCE_KINDS)[number], r.name);
        await tx.update(s.provisionedResources).set({ status: 'deleted', updatedAt: new Date() }).where(eq(s.provisionedResources.id, r.id));
      }
      await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'project', entityId: project.id, action: 'provisioning.deprovision', summary: `Deprovisioned dummy resources for ${project.key}` });
      return { ok: true };
    });
  }
}
