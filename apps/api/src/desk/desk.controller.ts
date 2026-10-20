import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { audit, resolveWidget, schema as s } from '@higgsden/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, loadProject, parse, uuidParam } from '../common/access.js';
import { ProvidersService } from '../common/providers.service.js';
import { DbService } from '../db/db.service.js';

@Controller('agencies/:agencyId/desk')
@UseGuards(SessionGuard, TenantGuard)
export class DeskController {
  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  @Get('conversations')
  conversations(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, (tx) =>
      tx
        .select({
          id: s.supportConversations.id,
          merchantName: s.supportConversations.merchantName,
          subject: s.supportConversations.subject,
          status: s.supportConversations.status,
          clientId: s.supportConversations.clientId,
          projectId: s.supportConversations.projectId,
          lastMessageAt: s.supportConversations.lastMessageAt,
        })
        .from(s.supportConversations)
        .orderBy(desc(s.supportConversations.lastMessageAt)),
    );
  }

  @Get('conversations/:conversationId')
  detail(@CurrentTenant() tenant: Tenant, @Param('conversationId') conversationId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const [row] = await tx.select().from(s.supportConversations).where(eq(s.supportConversations.id, uuidParam(conversationId)));
      if (!row) throw new NotFoundException();
      const messages = await tx.select().from(s.supportMessages).where(eq(s.supportMessages.conversationId, row.id)).orderBy(asc(s.supportMessages.createdAt));
      return { ...row, messages };
    });
  }

  @Post('conversations/:conversationId/replies')
  reply(@CurrentTenant() tenant: Tenant, @Param('conversationId') conversationId: string, @Body() body: unknown) {
    const input = parse(z.object({ body: z.string().trim().min(1).max(8000) }), body);
    return this.db.tenant(tenant, async (tx) => {
      const [row] = await tx.select().from(s.supportConversations).where(eq(s.supportConversations.id, uuidParam(conversationId)));
      if (!row) throw new NotFoundException();
      assertCan(tenant, 'conversations.handle', row.clientId);
      await tx.insert(s.supportMessages).values({ agencyId: tenant.agencyId, conversationId: row.id, authorKind: 'agent', authorId: tenant.userId, body: input.body });
      await tx.update(s.supportConversations).set({ lastMessageAt: new Date(), firstRespondedAt: row.firstRespondedAt ?? new Date() }).where(eq(s.supportConversations.id, row.id));
      return { ok: true };
    });
  }

  @Post('conversations/:conversationId/handover')
  handover(@CurrentTenant() tenant: Tenant, @Param('conversationId') conversationId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const [row] = await tx.select().from(s.supportConversations).where(eq(s.supportConversations.id, uuidParam(conversationId)));
      if (!row) throw new NotFoundException();
      await tx.update(s.supportConversations).set({ status: 'handed_over', assigneeId: tenant.userId }).where(eq(s.supportConversations.id, row.id));
      await tx.insert(s.supportMessages).values({ agencyId: tenant.agencyId, conversationId: row.id, authorKind: 'system', body: 'Conversation handed over to a person.' });
      return { ok: true };
    });
  }

  @Post('conversations/:conversationId/draft')
  async draft(@CurrentTenant() tenant: Tenant, @Param('conversationId') conversationId: string) {
    const llm = await this.providers.p.llm.complete({
      task: 'skill.triage',
      system: 'Draft a merchant reply. It is only sent after a person approves it.',
      prompt: `Conversation ${conversationId}`,
      tools: [{ name: 'propose_reply', description: 'Draft reply', inputSchema: { type: 'object' } }],
      maxTokens: 400,
    });
    return { text: llm.text, toolCalls: llm.toolCalls, mode: this.providers.p.llm.mode };
  }

  @Get('incidents')
  incidents(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, (tx) => tx.select().from(s.incidents).orderBy(desc(s.incidents.openedAt)).limit(50));
  }

  @Post('incidents')
  open(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    const input = parse(
      z.object({
        projectId: z.uuid(),
        title: z.string().trim().min(3).max(200),
        severity: z.enum(['sev1', 'sev2', 'sev3', 'sev4']),
        source: z.string().max(80).default('member'),
      }),
      body,
    );
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, input.projectId);
      assertCan(tenant, 'incidents.manage', project.clientId);
      const [row] = await tx
        .insert(s.incidents)
        .values({ agencyId: project.agencyId, clientId: project.clientId, projectId: project.id, title: input.title, severity: input.severity, source: input.source })
        .returning();
      await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'incident', entityId: row!.id, action: 'incident.open', summary: `Opened ${input.severity} ${input.title}` });
      return { id: row!.id };
    });
  }

  @Post('incidents/:incidentId/resolve')
  resolve(@CurrentTenant() tenant: Tenant, @Param('incidentId') incidentId: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        symptom: z.string().min(3),
        environmentName: z.string().min(2),
        rootCause: z.string().min(3),
        fix: z.string().min(3),
        affectedVersions: z.string().min(1),
        evidence: z.string().min(3),
      }),
      body,
    );
    return this.db.tenant(tenant, async (tx) => {
      const [incident] = await tx.select().from(s.incidents).where(eq(s.incidents.id, uuidParam(incidentId)));
      if (!incident) throw new NotFoundException();
      assertCan(tenant, 'incidents.manage', incident.clientId);
      const [resolution] = await tx.insert(s.resolutions).values({ ...input, agencyId: incident.agencyId, clientId: incident.clientId, projectId: incident.projectId, incidentId: incident.id }).returning();
      await tx.update(s.incidents).set({ status: 'resolved', resolvedAt: new Date() }).where(eq(s.incidents.id, incident.id));
      await audit(tx, { agencyId: incident.agencyId, actorId: tenant.userId, clientId: incident.clientId, projectId: incident.projectId, entityType: 'resolution', entityId: resolution!.id, action: 'incident.resolve', summary: `Resolved ${incident.title}` });
      return { id: resolution!.id };
    });
  }

  @Post('resolutions/:resolutionId/verify')
  verify(@CurrentTenant() tenant: Tenant, @Param('resolutionId') resolutionId: string) {
    return this.db.tenant(tenant, async (tx) => {
      const [resolution] = await tx.select().from(s.resolutions).where(eq(s.resolutions.id, uuidParam(resolutionId)));
      if (!resolution) throw new NotFoundException();
      assertCan(tenant, 'resolutions.verify', resolution.clientId);
      const [note] = await tx
        .insert(s.knowledgeNotes)
        .values({
          agencyId: resolution.agencyId,
          clientId: resolution.clientId,
          projectId: resolution.projectId,
          kind: 'resolution',
          title: `Resolution: ${resolution.symptom}`,
          body: `${resolution.rootCause}\n\nFix: ${resolution.fix}\n\nEvidence: ${resolution.evidence}`,
          verificationState: 'verified',
          authorId: tenant.userId,
        })
        .returning();
      await tx.update(s.resolutions).set({ verificationState: 'verified', knowledgeNoteId: note!.id }).where(eq(s.resolutions.id, resolution.id));
      return { knowledgeNoteId: note!.id };
    });
  }
}

/** Public merchant widget. Auth is the widget key plus the conversation token, not a member session. */
@Controller('widget')
export class WidgetController {
  constructor(private readonly db: DbService) {}

  @Post(':widgetKey/conversations')
  async open(@Param('widgetKey') widgetKey: string, @Body() body: unknown) {
    const input = parse(z.object({ merchantName: z.string().min(2), merchantEmail: z.email(), subject: z.string().min(3), body: z.string().min(3), consent: z.boolean() }), body);
    const resolved = await this.db.tenant({}, (tx) => resolveWidget(tx, widgetKey));
    if (!resolved) throw new NotFoundException();
    return this.db.tenant({ agencyId: resolved.agency_id }, async (tx) => {
      const token = crypto.randomUUID().replaceAll('-', '');
      const [conversation] = await tx
        .insert(s.supportConversations)
        .values({
          agencyId: resolved.agency_id,
          clientId: resolved.client_id,
          merchantName: input.merchantName,
          merchantEmail: input.merchantEmail,
          subject: input.subject,
          consentAt: input.consent ? new Date() : null,
          accessTokenHash: token,
          lastMessageAt: new Date(),
        })
        .returning();
      await tx.insert(s.supportMessages).values({ agencyId: resolved.agency_id, conversationId: conversation!.id, authorKind: 'merchant', body: input.body });
      return { conversationId: conversation!.id, token };
    });
  }
}
