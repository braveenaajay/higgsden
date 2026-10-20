import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const QUEUE = 'system';

// BullMQ needs a constructed client under ESM, and workers need maxRetriesPerRequest disabled.
function redis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    maxRetriesPerRequest: null,
  });
}

/** Proves the queue path end to end. Real queues (webhooks, email, pipelines) arrive with their tasks. */
@Injectable()
export class SystemQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemQueue.name);
  private queue?: Queue;
  private worker?: Worker;

  async onModuleInit() {
    this.queue = new Queue(QUEUE, { connection: redis() });
    await this.queue.upsertJobScheduler('heartbeat', { every: 60_000 }, { name: 'heartbeat' });

    this.worker = new Worker(
      QUEUE,
      async (job) => {
        this.logger.log(`${job.name} processed at ${new Date().toISOString()}`);
      },
      { connection: redis() },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`${job?.name} failed: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
