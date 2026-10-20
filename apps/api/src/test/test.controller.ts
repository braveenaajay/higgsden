import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { config } from '../config.js';

/** Used only by Playwright. Never mounted in production. */
@Controller('test')
export class TestController {
  private assertTest() {
    if (!config.testApi) throw new ForbiddenException();
  }

  @Get('whoami')
  whoami() {
    this.assertTest();
    return { testApi: true };
  }
}
