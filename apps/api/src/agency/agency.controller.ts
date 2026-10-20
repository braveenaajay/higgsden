import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { audit, schema as s, type Tx } from '@higgsden/db';
import { ACTIONS, canAnywhere, checkCap, ROLES, seesAllClients, type Action } from '@higgsden/policy';
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashToken, newToken } from '../auth/tokens.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, clientScope, loadProject, parse, uuidParam } from '../common/access.js';
import { ProvidersService } from '../common/providers.service.js';
import { config } from '../config.js';
import { DbService } from '../db/db.service.js';

const InviteBody = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(ROLES),
  clientIds: z.array(z.uuid()).default([]),
});
const MemberPatch = z.object({ role: z.enum(ROLES).optional(), clientIds: z.array(z.uuid()).optional() });
const ClientBody = z.object({ name: z.string().trim().min(2).max(80), summary: z.string().max(500).default('') });
const ProjectBody = z.object({
  clientId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key is 2 to 10 letters or digits, starting with a letter'),
  summary: z.string().max(1000).default(''),
  deliveryType: z.enum(['theme', 'app']).optional(),
  templateCode: z.string().optional(),
});
const SettingsBody = z.object({
  messageRetentionDays: z.number().int().min(7).max(3650).optional(),
  logRetentionDays: z.number().int().min(1).max(365).optional(),
  redactPii: z.boolean().optional(),
  requireChatConsent: z.boolean().optional(),
});

export async function seatUse(tx: Tx, agencyId: string) {
  const [members] = await tx.select({ n: count() }).from(s.memberships).where(and(eq(s.memberships.agencyId, agencyId), eq(s.memberships.status, 'active')));
  const [invites] = await tx.select({ n: count() }).from(s.invitations).where(and(eq(s.invitations.agencyId, agencyId), eq(s.invitations.status, 'pending')));
  return Number(members?.n ?? 0) + Number(invites?.n ?? 0);
}

export async function clientUse(tx: Tx, agencyId: string) {
  const [row] = await tx.select({ n: count() }).from(s.clients).where(and(eq(s.clients.agencyId, agencyId), isNull(s.clients.deletedAt)));
  return Number(row?.n ?? 0);
}

export async function agencyWithPlan(tx: Tx, agencyId: string) {
  const [row] = await tx.select().from(s.agencies).innerJoin(s.plans, eq(s.plans.code, s.agencies.planCode)).where(eq(s.agencies.id, agencyId));
  if (!row) throw new NotFoundException();
  return { agency: row.agencies, plan: row.plans };
}

@Controller('agencies/:agencyId')
@UseGuards(SessionGuard, TenantGuard)
export class AgencyController {
  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  @Get('workspace')
  workspace(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, async (tx) => {
      const { agency, plan } = await agencyWithPlan(tx, tenant.agencyId);
      const all = seesAllClients(tenant.role);
      const clients = await tx
        .select()
        .from(s.clients)
        .where(and(isNull(s.clients.deletedAt), clientScope(tenant, s.clients.id)))
        .orderBy(asc(s.clients.name));
      const projects = clients.length
        ? await tx
            .select({
              id: s.projects.id,
              clientId: s.projects.clientId,
              key: s.projects.key,
              name: s.projects.name,
              summary: s.projects.summary,
              status: s.projects.status,
              deliveryType: s.projects.deliveryType,
              storyCount: count(s.stories.id),
            })
            .from(s.projects)
            .leftJoin(s.stories, eq(s.stories.projectId, s.projects.id))
            .where(inArray(s.projects.clientId, clients.map((c) => c.id)))
            .groupBy(s.projects.id)
            .orderBy(asc(s.projects.name))
        : [];
      const [unread] = await tx
        .select({ n: count() })
        .from(s.notifications)
        .where(and(isNull(s.notifications.readAt), or(eq(s.notifications.userId, tenant.userId), all ? isNull(s.notifications.userId) : sql`false`)));

      return {
        agency: {
          id: agency.id,
          name: agency.name,
          slug: agency.slug,
          planCode: plan.code,
          planName: plan.name,
          subscriptionState: agency.subscriptionState,
          trialEndsAt: agency.trialEndsAt?.toISOString() ?? null,
          seats: { used: await seatUse(tx, agency.id), cap: plan.seatCap },
          clients: { used: await clientUse(tx, agency.id), cap: plan.clientCap },
        },
        role: tenant.role,
        seesAllClients: all,
        agencyActions: ACTIONS.filter((a: Action) => canAnywhere(tenant, a)),
        unreadNotifications: Number(unread?.n ?? 0),
        clients: clients.map((c) => ({
          id: c.id,
          name: c.name,
          summary: c.summary,
          widgetKey: c.widgetKey,
          projects: projects.filter((p) => p.clientId === c.id).map(({ clientId: _c, ...p }) => ({ ...p, storyCount: Number(p.storyCount) })),
        })),
      };
    });
  }

  // --- Members and invitations -------------------------------------------------

  @Get('members')
  members(@CurrentTenant() tenant: Tenant) {
    assertCanRead(tenant);
    return this.db.tenant(tenant, async (tx) => {
      const rows = await tx
        .select({ id: s.memberships.id, userId: s.users.id, name: s.users.name, email: s.users.email, role: s.memberships.role, status: s.memberships.status })
        .from(s.memberships)
        .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
        .where(and(eq(s.memberships.agencyId, tenant.agencyId), ne(s.memberships.status, 'removed')))
        .orderBy(asc(s.users.name));
      const assignments = await tx.select().from(s.clientAssignments);
      const invitations = await tx
        .select({ id: s.invitations.id, email: s.invitations.email, role: s.invitations.role, clientIds: s.invitations.clientIds, expiresAt: s.invitations.expiresAt })
        .from(s.invitations)
        .where(eq(s.invitations.status, 'pending'))
        .orderBy(desc(s.invitations.createdAt));
      const clients = await tx.select({ id: s.clients.id, name: s.clients.name }).from(s.clients).where(isNull(s.clients.deletedAt)).orderBy(asc(s.clients.name));
      const { plan } = await agencyWithPlan(tx, tenant.agencyId);
      return {
        seats: { used: rows.length + invitations.length, cap: plan.seatCap },
        clients,
        members: rows.map((m) => ({ ...m, clientIds: assignments.filter((a) => a.membershipId === m.id).map((a) => a.clientId) })),
        invitations: invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() })),
      };
    });
  }

  @Post('invitations')
  invite(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'members.manage');
    const input = parse(InviteBody, body);
    const token = newToken();
    return this.db.tenant(tenant, async (tx) => {
      const { agency, plan } = await agencyWithPlan(tx, tenant.agencyId);
      const cap = checkCap(await seatUse(tx, tenant.agencyId), plan.seatCap);
      if (!cap.allowed) {
        throw new ForbiddenException({ code: 'seat_cap', ...cap, message: `Seat cap reached: ${cap.used} of ${cap.cap} seats are used by members and pending invites.` });
      }
      await this.assertClients(tx, input.clientIds);
      const [already] = await tx
        .select({ id: s.memberships.id })
        .from(s.memberships)
        .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
        .where(and(eq(s.memberships.agencyId, tenant.agencyId), eq(s.users.email, input.email), eq(s.memberships.status, 'active')));
      if (already) throw new ConflictException({ code: 'already_member', message: `${input.email} is already a member.` });

      const [invitation] = await tx
        .insert(s.invitations)
        .values({
          agencyId: tenant.agencyId,
          email: input.email,
          role: input.role,
          clientIds: seesAllClients(input.role) ? [] : input.clientIds,
          tokenHash: hashToken(token),
          invitedBy: tenant.userId,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        })
        .returning();
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'invitation', entityId: invitation!.id, action: 'membership.invite', summary: `Invited ${input.email} as ${input.role.replace('_', ' ')}` });
      const link = `${config.publicUrl}/invite/${token}`;
      await this.providers.p.mailer
        .send({ to: input.email, subject: `You are invited to ${agency.name} on HiggsDEN`, text: `Accept the invite: ${link}\n\nIt expires in 7 days.` })
        .catch(() => undefined);
      // The link is returned only in development so the demo and tests can follow it without reading email.
      return { id: invitation!.id, ...(config.devSignIn || config.testApi ? { link } : {}) };
    });
  }

  @Delete('invitations/:invitationId')
  revokeInvite(@CurrentTenant() tenant: Tenant, @Param('invitationId') invitationId: string) {
    assertCan(tenant, 'members.manage');
    return this.db.tenant(tenant, async (tx) => {
      const [row] = await tx.update(s.invitations).set({ status: 'revoked' }).where(and(eq(s.invitations.id, uuidParam(invitationId)), eq(s.invitations.status, 'pending'))).returning();
      if (!row) throw new NotFoundException();
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'invitation', entityId: row.id, action: 'membership.invite_revoke', summary: `Revoked the invite for ${row.email}` });
      return { ok: true };
    });
  }

  @Patch('members/:membershipId')
  updateMember(@CurrentTenant() tenant: Tenant, @Param('membershipId') membershipId: string, @Body() body: unknown) {
    assertCan(tenant, 'members.manage');
    const input = parse(MemberPatch, body);
    return this.db.tenant(tenant, async (tx) => {
      const member = await this.loadMember(tx, tenant.agencyId, membershipId);
      if (input.role && input.role !== member.role) {
        if (member.role === 'owner' && (await this.ownerCount(tx, tenant.agencyId)) <= 1) throw new BadRequestException({ code: 'last_owner', message: 'An Agency needs at least one Owner.' });
        if (input.role === 'owner' && tenant.role !== 'owner') throw new ForbiddenException({ code: 'forbidden', message: 'Only an Owner can make another Owner.' });
        await tx.update(s.memberships).set({ role: input.role }).where(eq(s.memberships.id, member.id));
        await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'membership', entityId: member.id, action: 'membership.role_change', summary: `Changed ${member.name} from ${member.role.replace('_', ' ')} to ${input.role.replace('_', ' ')}` });
      }
      if (input.clientIds) {
        await this.assertClients(tx, input.clientIds);
        const current = (await tx.select().from(s.clientAssignments).where(eq(s.clientAssignments.membershipId, member.id))).map((a) => a.clientId);
        const added = input.clientIds.filter((c) => !current.includes(c));
        const removed = current.filter((c) => !input.clientIds!.includes(c));
        if (removed.length) await tx.delete(s.clientAssignments).where(and(eq(s.clientAssignments.membershipId, member.id), inArray(s.clientAssignments.clientId, removed)));
        for (const clientId of added) await tx.insert(s.clientAssignments).values({ agencyId: tenant.agencyId, membershipId: member.id, clientId });
        if (added.length || removed.length) {
          await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'membership', entityId: member.id, action: 'membership.assignment_change', summary: `Changed ${member.name}'s Clients: ${added.length} added, ${removed.length} removed` });
        }
      }
      return { ok: true };
    });
  }

  @Delete('members/:membershipId')
  removeMember(@CurrentTenant() tenant: Tenant, @Param('membershipId') membershipId: string) {
    assertCan(tenant, 'members.manage');
    return this.db.tenant(tenant, async (tx) => {
      const member = await this.loadMember(tx, tenant.agencyId, membershipId);
      if (member.role === 'owner' && (await this.ownerCount(tx, tenant.agencyId)) <= 1) throw new BadRequestException({ code: 'last_owner', message: 'An Agency needs at least one Owner.' });
      await tx.update(s.memberships).set({ status: 'removed' }).where(eq(s.memberships.id, member.id));
      await tx.delete(s.clientAssignments).where(eq(s.clientAssignments.membershipId, member.id));
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'membership', entityId: member.id, action: 'membership.remove', summary: `Removed ${member.name}` });
      return { ok: true };
    });
  }

  // --- Clients and projects ---------------------------------------------------------

  @Post('clients')
  createClient(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'clients.create');
    const input = parse(ClientBody, body);
    return this.db.tenant(tenant, async (tx) => {
      const { plan } = await agencyWithPlan(tx, tenant.agencyId);
      const cap = checkCap(await clientUse(tx, tenant.agencyId), plan.clientCap);
      if (!cap.allowed) throw new ForbiddenException({ code: 'client_cap', ...cap, message: `Client cap reached: ${cap.used} of ${cap.cap} Clients.` });
      const [client] = await tx.insert(s.clients).values({ agencyId: tenant.agencyId, ...input }).returning();
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, clientId: client!.id, entityType: 'client', entityId: client!.id, action: 'client.create', summary: `Created Client ${client!.name}` });
      return { id: client!.id };
    });
  }

  @Post('projects')
  createProject(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'projects.create');
    const input = parse(ProjectBody, body);
    return this.db.tenant(tenant, async (tx) => {
      const [client] = await tx.select().from(s.clients).where(and(eq(s.clients.id, input.clientId), isNull(s.clients.deletedAt)));
      if (!client) throw new NotFoundException({ message: 'Create a Client before its first project.' });
      const [taken] = await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.key, input.key));
      if (taken) throw new ConflictException({ code: 'key_taken', message: `Project key ${input.key} is already used in this Agency.` });
      const [project] = await tx
        .insert(s.projects)
        .values({ agencyId: tenant.agencyId, clientId: client.id, name: input.name, key: input.key, summary: input.summary, deliveryType: input.deliveryType, templateCode: input.templateCode })
        .returning();
      await tx.insert(s.discoverySessions).values({ agencyId: tenant.agencyId, clientId: client.id, projectId: project!.id });
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, clientId: client.id, projectId: project!.id, entityType: 'project', entityId: project!.id, action: 'project.create', summary: `Created project ${input.key} ${input.name}` });
      return { id: project!.id };
    });
  }

  @Patch('projects/:projectId')
  updateProject(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(z.object({ name: z.string().min(2).max(80).optional(), summary: z.string().max(1000).optional(), deliveryType: z.enum(['theme', 'app']).optional() }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, input.deliveryType ? 'environments.manage' : 'projects.create', project.clientId);
      await tx.update(s.projects).set(input).where(eq(s.projects.id, project.id));
      if (input.deliveryType && input.deliveryType !== project.deliveryType) {
        await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'project', entityId: project.id, action: 'project.delivery_type', summary: `Set delivery type to ${input.deliveryType}` });
      }
      return { ok: true };
    });
  }

  // --- Settings, notifications, activity --------------------------------------------

  @Get('settings')
  settings(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, async (tx) => {
      const { agency } = await agencyWithPlan(tx, tenant.agencyId);
      return {
        messageRetentionDays: agency.messageRetentionDays,
        logRetentionDays: agency.logRetentionDays,
        redactPii: agency.redactPii,
        requireChatConsent: agency.requireChatConsent,
      };
    });
  }

  @Patch('settings')
  updateSettings(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'settings.manage');
    const input = parse(SettingsBody, body);
    return this.db.tenant(tenant, async (tx) => {
      await tx.update(s.agencies).set(input).where(eq(s.agencies.id, tenant.agencyId));
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, entityType: 'agency', entityId: tenant.agencyId, action: 'settings.change', summary: `Changed retention and privacy settings: ${Object.keys(input).join(', ')}` });
      return { ok: true };
    });
  }

  @Get('notifications')
  notifications(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, (tx) =>
      tx
        .select()
        .from(s.notifications)
        .where(or(eq(s.notifications.userId, tenant.userId), seesAllClients(tenant.role) ? isNull(s.notifications.userId) : sql`false`))
        .orderBy(desc(s.notifications.createdAt))
        .limit(50),
    );
  }

  @Post('notifications/read')
  readNotifications(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, async (tx) => {
      await tx
        .update(s.notifications)
        .set({ readAt: new Date() })
        .where(and(isNull(s.notifications.readAt), or(eq(s.notifications.userId, tenant.userId), seesAllClients(tenant.role) ? isNull(s.notifications.userId) : sql`false`)));
      return { ok: true };
    });
  }

  /** Agency-wide activity. Owners and Admins see everything; others see only their Clients' projects. */
  @Get('activity')
  activity(@CurrentTenant() tenant: Tenant, @Query('limit') limit?: string) {
    return this.db.tenant(tenant, (tx) =>
      tx
        .select({ id: s.auditEvents.id, action: s.auditEvents.action, summary: s.auditEvents.summary, actorName: s.users.name, actorKind: s.auditEvents.actorKind, projectId: s.auditEvents.projectId, createdAt: s.auditEvents.createdAt })
        .from(s.auditEvents)
        .leftJoin(s.users, eq(s.users.id, s.auditEvents.actorId))
        .where(seesAllClients(tenant.role) ? undefined : clientScope(tenant, s.auditEvents.clientId))
        .orderBy(desc(s.auditEvents.createdAt))
        .limit(Math.min(Number(limit ?? 50) || 50, 200)),
    );
  }

  /** Owner only. Removes every tenant row through the foreign-key cascade. */
  @Delete()
  deleteAgency(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'agency.delete');
    const { confirmName } = parse(z.object({ confirmName: z.string() }), body);
    return this.db.tenant(tenant, async (tx) => {
      const { agency } = await agencyWithPlan(tx, tenant.agencyId);
      if (confirmName !== agency.name) throw new BadRequestException({ code: 'confirm', message: 'Type the Agency name exactly to delete it.' });
      await tx.delete(s.agencies).where(eq(s.agencies.id, agency.id));
      return { ok: true };
    });
  }

  private async assertClients(tx: Tx, clientIds: string[]) {
    if (!clientIds.length) return;
    const found = await tx.select({ id: s.clients.id }).from(s.clients).where(and(inArray(s.clients.id, clientIds), isNull(s.clients.deletedAt)));
    if (found.length !== new Set(clientIds).size) throw new NotFoundException({ message: 'Unknown Client' });
  }

  private async loadMember(tx: Tx, agencyId: string, membershipId: string) {
    const [member] = await tx
      .select({ id: s.memberships.id, role: s.memberships.role, name: s.users.name })
      .from(s.memberships)
      .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
      .where(and(eq(s.memberships.agencyId, agencyId), eq(s.memberships.id, uuidParam(membershipId)), eq(s.memberships.status, "active")));
    if (!member) throw new NotFoundException();
    return member;
  }

  private async ownerCount(tx: Tx, agencyId: string) {
    const [row] = await tx.select({ n: count() }).from(s.memberships).where(and(eq(s.memberships.agencyId, agencyId), eq(s.memberships.role, "owner"), eq(s.memberships.status, "active")));
    return Number(row?.n ?? 0);
  }
}

function assertCanRead(tenant: Tenant) {
  if (!seesAllClients(tenant.role) && tenant.role !== 'delivery_lead') {
    throw new ForbiddenException({ code: 'forbidden', message: 'Only Owners, Admins, and Delivery Leads can see the member list.' });
  }
}
