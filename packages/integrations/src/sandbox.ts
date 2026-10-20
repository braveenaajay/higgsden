import { schema, type Db } from '@higgsden/db';
import { and, eq } from 'drizzle-orm';

const t = schema.sandboxResources;

/** Persistent state for the local fakes, so GitHub, AWS, and Shopify behave consistently across restarts. */
export class Sandbox {
  constructor(private readonly db: Db) {}

  async get<T = Record<string, unknown>>(kind: string, name: string): Promise<T | null> {
    const [row] = await this.db.select().from(t).where(and(eq(t.kind, kind), eq(t.name, name)));
    return (row?.data as T | undefined) ?? null;
  }

  async put(kind: string, name: string, data: object): Promise<void> {
    await this.db.insert(t).values({ kind, name, data: data as Record<string, unknown> }).onConflictDoUpdate({ target: [t.kind, t.name], set: { data: data as Record<string, unknown> } });
  }

  /** Inserts only when absent and reports whether this call created it. */
  async create(kind: string, name: string, data: object): Promise<boolean> {
    const rows = await this.db.insert(t).values({ kind, name, data: data as Record<string, unknown> }).onConflictDoNothing().returning({ id: t.id });
    return rows.length > 0;
  }

  async list<T = Record<string, unknown>>(kind: string): Promise<{ name: string; data: T }[]> {
    const rows = await this.db.select().from(t).where(eq(t.kind, kind)).orderBy(t.createdAt);
    return rows.map((r) => ({ name: r.name, data: r.data as T }));
  }

  async remove(kind: string, name: string): Promise<boolean> {
    const rows = await this.db.delete(t).where(and(eq(t.kind, kind), eq(t.name, name))).returning({ id: t.id });
    return rows.length > 0;
  }

  /** Fault injection for tests: the next call that checks this key fails once. */
  async takeFault(key: string): Promise<boolean> {
    return this.remove('fault', key);
  }
}
