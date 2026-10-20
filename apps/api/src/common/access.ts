import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { schema, type Tx } from '@higgsden/db';
import { billingAllows, can, canOpenClient, seesAllClients, type Action } from '@higgsden/policy';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { ZodType } from 'zod';
import { isUuid, type Tenant } from '../auth/session.js';

/** Permission first, then the subscription state. Both refusals are 403 with a code the UI can explain. */
export function assertCan(tenant: Tenant, action: Action, clientId?: string) {
  if (!can(tenant, action, clientId)) {
    throw new ForbiddenException({ code: 'forbidden', action, message: `Your role cannot do this (${action}).` });
  }
  const billing = billingAllows(tenant.subscriptionState, action);
  if (!billing.allowed) {
    throw new ForbiddenException({
      code: billing.reason,
      action,
      message:
        billing.reason === 'past_due'
          ? 'The subscription is past due. Reading, search, and support requests still work. Creating is paused until billing is fixed.'
          : 'The subscription is canceled.',
    });
  }
}

export function parse<T>(schemaDef: ZodType<T>, body: unknown): T {
  const result = schemaDef.safeParse(body ?? {});
  if (!result.success) {
    throw new BadRequestException({ code: 'invalid', message: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
  }
  return result.data;
}

export function uuidParam(value: string): string {
  if (!isUuid(value)) throw new NotFoundException();
  return value;
}

/** Restricts a query to the Clients the member can open. Owner and Admin see all. */
export function clientScope(tenant: Tenant, column: PgColumn): SQL | undefined {
  if (seesAllClients(tenant.role)) return undefined;
  if (tenant.assignedClientIds.length === 0) return sql`false`;
  return inArray(column, tenant.assignedClientIds);
}

export type ProjectRow = typeof schema.projects.$inferSelect;

/** Row-level security hides other Agencies. This also hides Clients the member is not assigned to. */
export async function loadProject(tx: Tx, tenant: Tenant, projectId: string): Promise<ProjectRow> {
  uuidParam(projectId);
  const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project || !canOpenClient(tenant, project.clientId)) throw new NotFoundException();
  return project;
}

/** Loads any Client-scoped row by id and applies the same Client check. */
export async function loadScoped<T extends { clientId: string }>(rows: Promise<T[]>, tenant: Tenant): Promise<T> {
  const [row] = await rows;
  if (!row || !canOpenClient(tenant, row.clientId)) throw new NotFoundException();
  return row;
}
