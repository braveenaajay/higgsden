import { Global, Module } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { ProvidersService } from '../common/providers.service.js';
import { QueueService } from '../common/queue.service.js';
import { DbService } from './db.service.js';

@Global()
@Module({
  providers: [DbService, AuthService, ProvidersService, QueueService],
  exports: [DbService, AuthService, ProvidersService, QueueService],
})
export class DbModule {}
