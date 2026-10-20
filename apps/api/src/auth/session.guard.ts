import { ForbiddenException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { webHeaders, type AppRequest } from './session.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const session = await this.auth.auth.api.getSession({ headers: webHeaders(req) });
    if (!session) throw new UnauthorizedException();
    const u = session.user as typeof session.user & { isOperator?: boolean };
    req.user = { id: u.id, email: u.email, name: u.name, isOperator: !!u.isOperator };
    return true;
  }
}

/** The operator console has its own route tree and this guard. Operators reach tenant data only through it. */
@Injectable()
export class OperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.user?.isOperator) throw new ForbiddenException();
    return true;
  }
}
