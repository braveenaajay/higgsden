import { Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { schema as s } from '@higgsden/db';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { DbService } from '../db/db.service.js';

/** Used only by Playwright. Never mounted in production. */
@Controller('test')
export class TestController {
  constructor(private readonly db: DbService) {}

  private assertTest() {
    if (!config.testApi) throw new ForbiddenException();
  }

  @Get('whoami')
  whoami() {
    this.assertTest();
    return { testApi: true };
  }

  @Post('past-due')
  async pastDue() {
    this.assertTest();
    await this.db.db.update(s.agencies).set({ subscriptionState: 'past_due' }).where(eq(s.agencies.slug, 'northwind'));
    return { ok: true };
  }

  @Post('restore-billing')
  async restore() {
    this.assertTest();
    await this.db.db.update(s.agencies).set({ subscriptionState: 'active' }).where(eq(s.agencies.slug, 'northwind'));
    return { ok: true };
  }
}
