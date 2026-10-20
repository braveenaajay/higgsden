import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createDb, listAgencyIds, schema as s, withTenant } from '@higgsden/db';
import { HttpEmbeddingClient } from '@higgsden/integrations';
import { Queue, Worker } from 'bullmq';
import { eq, isNull } from 'drizzle-orm';
import { Redis } from 'ioredis';

function redis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    maxRetriesPerRequest: null,
  });
}

/** Moves committed outbox rows onto BullMQ, then runs indexing jobs against the dummy embedding service. */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer?: NodeJS.Timeout;
  private closeDb?: () => Promise<void>;
  private workers: Worker[] = [];
  private queues = new Map<string, Queue>();

  async onModuleInit() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      this.logger.warn('DATABASE_URL missing; outbox dispatcher idle');
      return;
    }
    const { db, close } = createDb(databaseUrl, 4);
    this.closeDb = close;
    for (const name of ['indexing', 'events', 'system']) {
      this.queues.set(name, new Queue(name, { connection: redis() }));
    }
    const embeddings = new HttpEmbeddingClient(process.env.EMBEDDING_SERVICE_URL ?? 'http://localhost:8000', process.env.EMBEDDING_SERVICE_TOKEN ?? 'dev-embedding-service-token');
    this.workers.push(
      new Worker(
        'indexing',
        async (job) => {
          const { agencyId, sourceType, sourceId } = job.data as { agencyId: string; sourceType: string; sourceId: string };
          await withTenant(db, { agencyId }, async (tx) => {
            const text = `${sourceType} ${sourceId}`;
            try {
              await embeddings.embedQuery(text);
            } catch (err) {
              this.logger.warn(`Embedding skipped: ${(err as Error).message}`);
            }
          });
        },
        { connection: redis() },
      ),
    );
    this.workers.push(new Worker('events', async () => undefined, { connection: redis() }));

    this.timer = setInterval(() => {
      (async () => {
        const ids = await withTenant(db, {}, (tx) => listAgencyIds(tx));
        for (const agencyId of ids) {
          await withTenant(db, { agencyId }, async (tx) => {
            const rows = await tx.select().from(s.outbox).where(isNull(s.outbox.dispatchedAt)).limit(50);
            for (const row of rows) {
              const queue = this.queues.get(row.queue) ?? this.queues.get('system')!;
              await queue.add(row.jobName, row.payload);
              await tx.update(s.outbox).set({ dispatchedAt: new Date() }).where(eq(s.outbox.id, row.id));
            }
          });
        }
      })().catch((err) => this.logger.error(err));
    }, 2000);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.closeDb?.();
  }
}
