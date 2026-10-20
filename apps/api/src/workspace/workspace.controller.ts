import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import type { WorkspaceResponse } from '@higgsden/contracts';
import { schema } from '@higgsden/db';
import { seesAllClients } from '@higgsden/policy';
import { asc, count, eq, inArray } from 'drizzle-orm';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { DbService } from '../db/db.service.js';

@Controller('agencies/:agencyId')
@UseGuards(SessionGuard, TenantGuard)
export class WorkspaceController {
  constructor(private readonly db: DbService) {}

  @Get('workspace')
  workspace(@CurrentTenant() tenant: Tenant): Promise<WorkspaceResponse> {
    return this.db.tenant(tenant, async (tx) => {
      const [agency] = await tx
        .select({
          id: schema.agencies.id,
          name: schema.agencies.name,
          planCode: schema.agencies.planCode,
          subscriptionState: schema.agencies.subscriptionState,
        })
        .from(schema.agencies)
        .where(eq(schema.agencies.id, tenant.agencyId));
      if (!agency) throw new NotFoundException();

      const all = seesAllClients(tenant.role);
      if (!all && tenant.assignedClientIds.length === 0) {
        return { agency, role: tenant.role, seesAllClients: all, clients: [] };
      }

      const clientFilter = all ? undefined : inArray(schema.clients.id, tenant.assignedClientIds);
      const clients = await tx.select().from(schema.clients).where(clientFilter).orderBy(asc(schema.clients.name));

      const projects = clients.length
        ? await tx
            .select({
              id: schema.projects.id,
              clientId: schema.projects.clientId,
              key: schema.projects.key,
              name: schema.projects.name,
              summary: schema.projects.summary,
              status: schema.projects.status,
              storyCount: count(schema.stories.id),
            })
            .from(schema.projects)
            .leftJoin(schema.stories, eq(schema.stories.projectId, schema.projects.id))
            .where(inArray(schema.projects.clientId, clients.map((c) => c.id)))
            .groupBy(schema.projects.id)
            .orderBy(asc(schema.projects.name))
        : [];

      return {
        agency,
        role: tenant.role,
        seesAllClients: all,
        clients: clients.map((c) => ({
          id: c.id,
          name: c.name,
          summary: c.summary,
          projects: projects
            .filter((p) => p.clientId === c.id)
            .map(({ clientId: _clientId, ...p }) => ({ ...p, storyCount: Number(p.storyCount) })),
        })),
      };
    });
  }
}
