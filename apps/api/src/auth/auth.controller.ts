import { All, BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashToken } from './tokens.js';
import { audit, DEMO_PASSWORD, resolveAgency, schema as s, type Tx } from '@higgsden/db';
import { slugify } from '@higgsden/domain';
import { asc, eq, and } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse } from '../common/access.js';
import { ProvidersService } from '../common/providers.service.js';
import { config } from '../config.js';
import { DbService } from '../db/db.service.js';
import { AuthService } from './auth.service.js';
import { enabledSocialProviders } from './better-auth.js';
import { SessionGuard } from './session.guard.js';
import { webHeaders, type AppRequest, type SessionUser } from './session.js';
import { CurrentUser } from './tenant.guard.js';

const OnboardingBody = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['agency', 'brand']).default('agency'),
});

@Controller()
export class AuthController {
  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly providers: ProvidersService,
  ) {}

  /** Better Auth owns sign-up, sign-in, sign-out, social callbacks, and sessions. */
  @All('auth/*')
  async betterAuth(@Req() req: AppRequest, @Res() reply: FastifyReply) {
    const url = new URL(req.url, config.publicUrl);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined;
    const response = await this.auth.auth.handler(
      new Request(url, { method: req.method, headers: webHeaders(req), body: hasBody ? JSON.stringify(req.body) : undefined }),
    );
    reply.status(response.status);
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    reply.send(await response.text());
  }

  @Get('auth-config')
  authConfig() {
    return { socialProviders: enabledSocialProviders(), devSignIn: config.devSignIn };
  }

  /** Demo sign-in. Issues a real Better Auth session for a seeded user. */
  @Get('dev/users')
  async demoUsers() {
    if (!config.devSignIn) throw new NotFoundException();
    const users = await this.db.db.select().from(s.users).orderBy(asc(s.users.createdAt), asc(s.users.email));
    return Promise.all(
      users.map(async (u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isOperator: u.isOperator,
        memberships: (await this.membershipsOf(u.id)).map((m) => ({ agencyName: m.agencyName, role: m.role })),
      })),
    );
  }

  @Post('dev/sign-in')
  @HttpCode(204)
  async demoSignIn(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!config.devSignIn) throw new NotFoundException();
    const { userId } = parse(z.object({ userId: z.uuid() }), body);
    const [user] = await this.db.db.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId));
    if (!user) throw new BadRequestException('Unknown user');
    const response = await this.auth.auth.api.signInEmail({ body: { email: user.email, password: DEMO_PASSWORD }, asResponse: true });
    if (!response.ok) throw new BadRequestException('Demo sign-in failed');
    reply.header('set-cookie', response.headers.getSetCookie());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@CurrentUser() user: SessionUser) {
    return { user, memberships: await this.membershipsOf(user.id) };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const response = await this.auth.auth.api.signOut({ headers: webHeaders(req), asResponse: true });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
  }

  /** Sign-up step two: the new user opens an Agency, or a brand opens an Agency and Client in its own name. */
  @Post('onboarding/agency')
  @UseGuards(SessionGuard)
  async createAgency(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const input = parse(OnboardingBody, body);
    const agencyId = crypto.randomUUID();
    const [plan] = await this.db.db.select().from(s.plans).where(eq(s.plans.code, 'trial'));
    if (!plan) throw new Error('Trial plan missing from the catalog');
    const { customerId } = await this.providers.p.billing.createCustomer({ agencyId, name: input.name, email: user.email });

    return this.db.tenant({ userId: user.id, agencyId }, async (tx) => {
      await tx.insert(s.agencies).values({
        id: agencyId,
        name: input.name,
        slug: `${slugify(input.name) || 'agency'}-${randomBytes(2).toString('hex')}`,
        planCode: plan.code,
        subscriptionState: 'trialing',
        trialEndsAt: new Date(Date.now() + plan.trialDays * 86_400_000),
        spendCapCents: plan.defaultSpendCapCents,
        stripeCustomerId: customerId,
        cellId: 'cell-1',
      });
      await tx.insert(s.memberships).values({ agencyId, userId: user.id, role: 'owner' });
      await audit(tx, { agencyId, actorId: user.id, entityType: 'agency', entityId: agencyId, action: 'agency.create', summary: `Opened ${input.name} on a ${plan.trialDays}-day trial` });
      let clientId: string | null = null;
      if (input.kind === 'brand') {
        const [client] = await tx.insert(s.clients).values({ agencyId, name: input.name, summary: 'Brand team working directly in its own Agency.' }).returning();
        clientId = client!.id;
        await audit(tx, { agencyId, actorId: user.id, clientId, entityType: 'client', entityId: clientId, action: 'client.create', summary: `Created Client ${input.name}` });
      }
      return { agencyId, clientId };
    });
  }

  @Get('invitations/:token')
  async invitation(@Param('token') token: string) {
    const tokenHash = hashToken(token);
    const agencyId = await this.db.tenant({}, (tx) => resolveAgency(tx, 'resolve_invitation', tokenHash));
    if (!agencyId) throw new NotFoundException();
    const { id: _id, clientIds: _clients, ...invite } = await this.db.tenant({ agencyId }, (tx) => this.readInvitation(tx, agencyId, tokenHash));
    return invite;
  }

  @Post('invitations/:token/accept')
  @UseGuards(SessionGuard)
  async acceptInvitation(@CurrentUser() user: SessionUser, @Param('token') token: string) {
    const tokenHash = hashToken(token);
    const agencyId = await this.db.tenant({}, (tx) => resolveAgency(tx, 'resolve_invitation', tokenHash));
    if (!agencyId) throw new NotFoundException();

    return this.db.tenant({ userId: user.id, agencyId }, async (tx) => {
      const invite = await this.readInvitation(tx, agencyId, tokenHash);
      if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new ForbiddenException({ code: 'wrong_user', message: `This invite is for ${invite.email}. Sign in with that address to accept it.` });
      }
      const [existing] = await tx.select().from(s.memberships).where(and(eq(s.memberships.agencyId, agencyId), eq(s.memberships.userId, user.id)));
      const [membership] = existing
        ? await tx.update(s.memberships).set({ role: invite.role, status: 'active' }).where(eq(s.memberships.id, existing.id)).returning()
        : await tx.insert(s.memberships).values({ agencyId, userId: user.id, role: invite.role }).returning();
      await tx.delete(s.clientAssignments).where(eq(s.clientAssignments.membershipId, membership!.id));
      for (const clientId of invite.clientIds) {
        await tx.insert(s.clientAssignments).values({ agencyId, membershipId: membership!.id, clientId }).onConflictDoNothing();
      }
      await tx.update(s.invitations).set({ status: 'accepted' }).where(eq(s.invitations.id, invite.id));
      await audit(tx, { agencyId, actorId: user.id, entityType: 'membership', entityId: membership!.id, action: 'membership.join', summary: `${user.name} joined as ${invite.role.replace('_', ' ')}` });
      return { agencyId };
    });
  }

  private async readInvitation(tx: Tx, agencyId: string, tokenHash: string) {
    const [row] = await tx
      .select({ id: s.invitations.id, email: s.invitations.email, role: s.invitations.role, clientIds: s.invitations.clientIds, agencyName: s.agencies.name })
      .from(s.invitations)
      .innerJoin(s.agencies, eq(s.agencies.id, s.invitations.agencyId))
      .where(and(eq(s.invitations.tokenHash, tokenHash), eq(s.invitations.status, 'pending')));
    if (!row) throw new NotFoundException();
    return row;
  }

  private membershipsOf(userId: string) {
    return this.db.tenant({ userId }, (tx) =>
      tx
        .select({
          agencyId: s.agencies.id,
          agencyName: s.agencies.name,
          agencySlug: s.agencies.slug,
          role: s.memberships.role,
          subscriptionState: s.agencies.subscriptionState,
        })
        .from(s.memberships)
        .innerJoin(s.agencies, eq(s.agencies.id, s.memberships.agencyId))
        .where(and(eq(s.memberships.userId, userId), eq(s.memberships.status, 'active')))
        .orderBy(asc(s.agencies.name)),
    );
  }
}
