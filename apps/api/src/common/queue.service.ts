import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';

/**
 * Direct queue access for the test clock only. Product code enqueues through the outbox in its own transaction.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, { queue: Queue; events: QueueEvents }>();

  private get(name: string) {
    let entry = this.queues.get(name);
    if (!entry) {
      const connection = () => new Redis({ ...config.redis, maxRetriesPerRequest: null });
      entry = { queue: new Queue(name, { connection: connection() }), events: new QueueEvents(name, { connection: connection() }) };
      this.queues.set(name, entry);
    }
    return entry;
  }

  async runAndWait(queue: string, jobName: string, data: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    const { queue: q, events } = this.get(queue);
    await events.waitUntilReady();
    const job = await q.add(jobName, data, { removeOnComplete: 100, removeOnFail: 100 });
    return job.waitUntilFinished(events, timeoutMs);
  }

  async onModuleDestroy() {
    for (const { queue, events } of this.queues.values()) {
      await events.close();
      await queue.close();
    }
  }
}
