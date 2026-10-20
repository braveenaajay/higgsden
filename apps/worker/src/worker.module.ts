import { Module } from '@nestjs/common';
import { OutboxDispatcher } from './outbox.js';
import { SystemQueue } from './system.queue.js';

@Module({
  providers: [SystemQueue, OutboxDispatcher],
})
export class WorkerModule {}
