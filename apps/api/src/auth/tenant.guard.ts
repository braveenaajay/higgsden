import {
  createParamDecorator,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { schema } from '@higgsden/db';
import { canceledAllowsRead } from '@higgsden/policy';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { isUuid, type AppRequest, type Tenant } from './session.js';

const BILLING_AREA = 'higgsden:billing-area';
/** Routes an Owner can still open when the subscription is canceled. */
export const BillingArea = () => SetMetadata(BILLING_AREA, true);

/**
 * Resolves the member's role and Client assignments for the `:agencyId` route param.
 * Use after SessionGuard. A non-member gets 404 so Agency ids cannot be probed.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly db: DbService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const agencyId = (req.params as Record<string, string | undefined>).agencyId;
    if (!req.user || !isUuid(agencyId)) throw new NotFoundException();
    const userId = req.user.id;

    const tenant = await this.db.tenant({ userId, agencyId }, async (tx) => {
      const [membership] = await tx
        .select({ id: schema.memberships.id, role: schema.memberships.role, slug: schema.agencies.slug, state: schema.agencies.subscriptionState })
        .from(schema.memberships)
        .innerJoin(schema.agencies, eq(schema.agencies.id, schema.memberships.agencyId))
        .where(and(eq(schema.memberships.agencyId, agencyId), eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active')));
      if (!membership) return null;

      const assignments = await tx
        .select({ clientId: schema.clientAssignments.clientId })
        .from(schema.clientAssignments)
        .where(eq(schema.clientAssignments.membershipId, membership.id));

      return {
        userId,
        agencyId,
        agencySlug: membership.slug,
        membershipId: membership.id,
        role: membership.role,
        assignedClientIds: assignments.map((a) => a.clientId),
        subscriptionState: membership.state,
      } satisfies Tenant;
    });

    if (!tenant) throw new NotFoundException();
    const billingArea = this.reflector.getAllAndOverride<boolean>(BILLING_AREA, [context.getHandler(), context.getClass()]) ?? false;
    if (!canceledAllowsRead(tenant.subscriptionState, tenant.role, billingArea ? 'billing' : 'other')) {
      throw new ForbiddenException({ code: 'canceled', message: 'The subscription is canceled. Only the Owner can open billing.' });
    }
    req.tenant = tenant;
    return true;
  }
}

export const CurrentTenant = createParamDecorator((_data: unknown, context: ExecutionContext): Tenant => {
  const tenant = context.switchToHttp().getRequest<AppRequest>().tenant;
  if (!tenant) throw new NotFoundException();
  return tenant;
});

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new NotFoundException();
  return user;
});
