import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createDb, withTenant, type Db, type TenantContext, type Tx } from '@higgsden/db';
import { config } from '../config.js';

@Injectable()
export class DbService implements OnModuleDestroy {
  /** Runtime role. Row-level security applies to every tenant table. */
  readonly db: Db;
  /** Operator console role. It can read Agencies, plans, support, and cost data only. */
  readonly operator: Db;
  private readonly closers: (() => Promise<void>)[] = [];

  constructor() {
    const app = createDb(config.databaseUrl, 20);
    const ops = createDb(config.operatorDatabaseUrl, 4);
    this.db = app.db;
    this.operator = ops.db;
    this.closers.push(app.close, ops.close);
  }

  tenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, ctx, fn);
  }

  async onModuleDestroy() {
    await Promise.all(this.closers.map((c) => c()));
  }
}
