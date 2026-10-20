import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { audit, resolveAgency, schema as s } from '@higgsden/db';
import { FakeGitHub, verifyGitHub } from '@higgsden/integrations';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { AppRequest, Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, loadProject, parse, uuidParam } from '../common/access.js';
import { ProvidersService } from '../common/providers.service.js';
import { DbService } from '../db/db.service.js';
import { runPullRequestPipeline } from '../delivery/pipeline.js';

const STORY_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/;

@Controller()
export class GitHubWebhookController {
  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  @Post('webhooks/github')
  @HttpCode(200)
  async webhook(@Req() req: AppRequest) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    if (!verifyGitHub(this.providers.p.config.githubWebhookSecret, raw, req.headers['x-hub-signature-256'] as string | undefined)) {
      throw new UnauthorizedException('Invalid signature');
    }
    const event = String(req.headers['x-github-event'] ?? '');
    const deliveryId = String(req.headers['x-github-delivery'] ?? crypto.randomUUID());
    const payload = JSON.parse(raw) as {
      action?: string;
      installation?: { id: number };
      repository?: { id: number; full_name: string };
      pull_request?: { number: number; html_url: string; title: string; body?: string; state: string; merged?: boolean; head?: { ref: string; sha: string } };
    };
    const installationId = payload.installation?.id;
    const agencyId = installationId ? await this.db.tenant({}, (tx) => resolveAgency(tx, 'resolve_github_installation', installationId)) : null;
    return this.db.tenant({ agencyId }, async (tx) => {
      const [delivery] = await tx
        .insert(s.webhookDeliveries)
        .values({ provider: 'github', deliveryId, eventType: event, agencyId, outcome: agencyId ? 'processed' : 'ignored' })
        .onConflictDoNothing()
        .returning();
      if (!delivery) return { duplicate: true };
      if (!agencyId || event !== 'pull_request' || !payload.pull_request || !payload.repository) return { ignored: true };
      const [repo] = await tx.select().from(s.repositories).where(eq(s.repositories.githubRepoId, payload.repository.id));
      if (!repo?.projectId) return { ignored: true };
      const [project] = await tx.select().from(s.projects).where(eq(s.projects.id, repo.projectId));
      if (!project) return { ignored: true };
      const pr = payload.pull_request;
      const key = (pr.title + ' ' + (pr.body ?? '')).match(STORY_KEY)?.[1];
      const [story] = key ? await tx.select().from(s.stories).where(and(eq(s.stories.projectId, project.id), eq(s.stories.key, key))) : [];
      if (!story) return { unmatched: true };
      const [link] = await tx
        .insert(s.pullRequestLinks)
        .values({
          agencyId,
          clientId: project.clientId,
          projectId: project.id,
          storyId: story.id,
          repositoryId: repo.id,
          number: pr.number,
          url: pr.html_url,
          title: pr.title,
          state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
          headBranch: pr.head?.ref,
          headSha: pr.head?.sha,
          linkedBy: 'webhook',
        })
        .onConflictDoNothing()
        .returning();
      if (link) {
        await audit(tx, { agencyId, actorKind: 'webhook', clientId: project.clientId, projectId: project.id, entityType: 'pull_request_link', entityId: link.id, action: 'pull_request.link', summary: `Linked ${story.key} to ${repo.fullName}#${pr.number}` });
      }
      const [resolved] = link ? [link] : await tx.select().from(s.pullRequestLinks).where(and(eq(s.pullRequestLinks.repositoryId, repo.id), eq(s.pullRequestLinks.number, pr.number)));
      if (resolved && (payload.action === 'opened' || payload.action === 'synchronize')) {
        await runPullRequestPipeline(tx, this.providers.p, { project, repo, story, link: resolved, sha: pr.head?.sha ?? 'unknown' });
      }
      if (resolved && (payload.action === 'closed' || pr.state === 'closed')) {
        await tx.update(s.pullRequestLinks).set({ state: pr.merged ? 'merged' : 'closed' }).where(eq(s.pullRequestLinks.id, resolved.id));
      }
      return { ok: true, story: story.key };
    });
  }

  @Get('github/fake-install')
  fakeInstallPage(@Query('state') state: string, @Res() reply: FastifyReply) {
    if (!(this.providers.p.github instanceof FakeGitHub)) throw new NotFoundException();
    const esc = (v: string) => encodeURIComponent(v);
    reply.type('text/html').send(`<!doctype html><html><head><title>GitHub App (local fake)</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:0 16px">
<p style="color:#71717a">GitHub App test install</p>
<h1>Install on a demo organization</h1>
<p>No GitHub account is used. Three demo repositories are created.</p>
<form method="post" action="/api/github/fake-install"><input type="hidden" name="state" value="${esc(state ?? '')}">
<label>Organization <input name="account" value="northwind-demo"></label>
<button type="submit">Install</button></form></body></html>`);
  }

  @Post('github/fake-install')
  async completeFakeInstall(@Body() body: Record<string, string>, @Res() reply: FastifyReply) {
    const github = this.providers.p.github;
    if (!(github instanceof FakeGitHub)) throw new NotFoundException();
    const account = String(body.account || 'northwind-demo');
    const installationId = await github.registerInstallation(account);
    const state = String(body.state || '');
    reply.redirect(`/api/github/callback?installation_id=${installationId}&state=${encodeURIComponent(state)}`, 303);
  }

  @Get('github/callback')
  async callback(@Query('installation_id') installationIdRaw: string, @Query('state') agencyId: string, @Res() reply: FastifyReply) {
    const installationId = Number(installationIdRaw);
    const info = await this.providers.p.github.getInstallation(installationId);
    if (!info || !agencyId) throw new NotFoundException();
    await this.db.tenant({ agencyId }, async (tx) => {
      const [row] = await tx
        .insert(s.githubInstallations)
        .values({ agencyId, installationId, accountLogin: info.accountLogin })
        .onConflictDoNothing()
        .returning();
      const installation = row ?? (await tx.select().from(s.githubInstallations).where(eq(s.githubInstallations.installationId, installationId)))[0];
      if (!installation) return;
      for (const repo of await this.providers.p.github.listRepositories(installationId)) {
        await tx.insert(s.repositories).values({ agencyId, installationId: installation.id, githubRepoId: repo.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch }).onConflictDoNothing();
      }
    });
    reply.redirect(`/a/${agencyId}/github`, 303);
  }
}

@Controller('agencies/:agencyId/github')
@UseGuards(SessionGuard, TenantGuard)
export class GitHubController {
  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  status(@CurrentTenant() tenant: Tenant) {
    return this.db.tenant(tenant, async (tx) => {
      const [installation] = await tx.select().from(s.githubInstallations).where(eq(s.githubInstallations.agencyId, tenant.agencyId));
      const repos = await tx.select().from(s.repositories);
      return {
        mode: this.providers.p.github.mode,
        installUrl: this.providers.p.github.installUrl(tenant.agencyId),
        installation: installation ? { id: installation.id, accountLogin: installation.accountLogin, permissionLevel: installation.permissionLevel } : null,
        repositories: repos.map((r) => ({ id: r.id, fullName: r.fullName, projectId: r.projectId })),
      };
    });
  }

  @Post('repositories/:repositoryId/attach')
  attach(@CurrentTenant() tenant: Tenant, @Param('repositoryId') repositoryId: string, @Body() body: unknown) {
    assertCan(tenant, 'repositories.attach');
    const { projectId } = parse(z.object({ projectId: z.uuid() }), body);
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      const [taken] = await tx.select().from(s.repositories).where(eq(s.repositories.projectId, project.id));
      if (taken && taken.id !== uuidParam(repositoryId)) throw new NotFoundException({ message: 'This project already has a repository.' });
      const [repo] = await tx.update(s.repositories).set({ projectId: project.id, attachedAt: new Date() }).where(eq(s.repositories.id, uuidParam(repositoryId))).returning();
      if (!repo) throw new NotFoundException();
      await audit(tx, { agencyId: tenant.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'repository', entityId: repo.id, action: 'repository.attach', summary: `Attached ${repo.fullName} to ${project.key}` });
      return { ok: true };
    });
  }

  @Post('link')
  link(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    const input = parse(z.object({ storyId: z.uuid(), repositoryId: z.uuid(), number: z.number().int().positive(), url: z.string().url(), title: z.string().min(1) }), body);
    return this.db.tenant(tenant, async (tx) => {
      const [story] = await tx.select().from(s.stories).where(eq(s.stories.id, input.storyId));
      if (!story) throw new NotFoundException();
      assertCan(tenant, 'pullRequests.link', story.clientId);
      const [row] = await tx
        .insert(s.pullRequestLinks)
        .values({ agencyId: tenant.agencyId, clientId: story.clientId, projectId: story.projectId, storyId: story.id, repositoryId: input.repositoryId, number: input.number, url: input.url, title: input.title, linkedBy: 'member' })
        .onConflictDoNothing()
        .returning();
      return { id: row?.id ?? null };
    });
  }
}
