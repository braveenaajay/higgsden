import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createProviders, providerModes, type Providers } from '@higgsden/integrations';
import { DbService } from '../db/db.service.js';

@Injectable()
export class ProvidersService implements OnModuleInit {
  readonly p: Providers;

  constructor(db: DbService) {
    this.p = createProviders(db.db);
  }

  onModuleInit() {
    new Logger('Providers').log(`External services: ${JSON.stringify(providerModes(this.p))}`);
  }
}
