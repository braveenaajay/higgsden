import { sql } from 'drizzle-orm';
import type { Tx } from './client.js';
import * as s from './schema.js';

export interface AuditInput {
  agencyId: string;
  actorId?: string | null;
  actorKind?: 'member' | 'system' | 'webhook' | 'agent' | 'operator';
  clientId?: string | null;
  projectId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  summary: string;
}

export async function audit(tx: Tx, input: AuditInput) {
  await tx.insert(s.auditEvents).values({
    agencyId: input.agencyId,
    actorId: input.actorId ?? null,
    actorKind: input.actorKind ?? (input.actorId ? 'member' : 'system'),
    clientId: input.clientId ?? null,
    projectId: input.projectId ?? null,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    summary: input.summary,
  });
}

/** Writes a job to the outbox in the caller's transaction. The worker's dispatcher moves it to BullMQ after commit. */
export async function enqueue(tx: Tx, agencyId: string, queue: string, jobName: string, payload: Record<string, unknown>) {
  await tx.insert(s.outbox).values({ agencyId, queue, jobName, payload });
}

export async function notify(
  tx: Tx,
  input: { agencyId: string; userId?: string | null; kind: string; title: string; body: string },
) {
  await tx.insert(s.notifications).values({ ...input, userId: input.userId ?? null });
}

export async function resolveAgency(
  tx: Tx,
  fn: 'resolve_github_installation' | 'resolve_stripe_customer' | 'resolve_invitation' | 'resolve_teams_tenant',
  arg: string | number,
) {
  const result = await tx.execute<{ agency_id: string | null }>(sql`select ${sql.raw(fn)}(${arg}) as agency_id`);
  return result.rows[0]?.agency_id ?? null;
}

/** Graph change notifications arrive with the Entra tenant id, not a signed-in member. */
export async function resolveTeamsTenant(tx: Tx, entraTenantId: string) {
  const result = await tx.execute<{ agency_id: string | null }>(sql`select resolve_teams_tenant(${entraTenantId}) as agency_id`);
  return result.rows[0]?.agency_id ?? null;
}

export async function listAgencyIds(tx: Tx): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(sql`select list_agency_ids() as id`);
  return result.rows.map((r) => r.id);
}

export async function resolveWidget(tx: Tx, widgetKey: string) {
  const result = await tx.execute<{ agency_id: string; client_id: string }>(sql`select * from resolve_widget(${widgetKey})`);
  return result.rows[0] ?? null;
}
