import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(connectionString: string, max = 10): { db: Db; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString, max });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

export interface TenantContext {
  /** Null for workers and webhooks acting for the Agency rather than for a person. */
  userId?: string | null;
  /** Omit only for queries that list the user's own memberships across Agencies. */
  agencyId?: string | null;
}

/**
 * Runs `fn` in a transaction with the row-level security settings applied.
 * Every tenant query from the API and workers must go through here.
 */
export function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${ctx.userId ?? ''}, true), set_config('app.agency_id', ${ctx.agencyId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
