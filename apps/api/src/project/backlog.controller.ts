import { BadRequestException, Body, Controller, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { audit, schema as s } from '@higgsden/db';
import { actionForStatusChange, readinessProblems, type StoryStatus } from '@higgsden/policy';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { Tenant } from '../auth/session.js';
import { CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { assertCan, loadProject, parse, uuidParam } from '../common/access.js';
import { DbService } from '../db/db.service.js';
import { createStory } from './stories.js';

@Controller('agencies/:agencyId/projects/:projectId/stories')
@UseGuards(SessionGuard, TenantGuard)
export class BacklogController {
  constructor(private readonly db: DbService) {}

  @Post()
  create(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        title: z.string().trim().min(3).max(160),
        description: z.string().max(8000).default(''),
        epicId: z.uuid().nullable().optional(),
        acceptanceCriteria: z.array(z.string().trim().min(3)).default([]),
      }),
      body,
    );
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      assertCan(tenant, 'stories.prepare', project.clientId);
      const story = await createStory(tx, { userId: tenant.userId }, project, input);
      return { id: story.id, key: story.key };
    });
  }

  @Patch(':storyId')
  update(@CurrentTenant() tenant: Tenant, @Param('projectId') projectId: string, @Param('storyId') storyId: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        title: z.string().trim().min(3).max(160).optional(),
        description: z.string().max(8000).optional(),
        status: z.enum(['proposed', 'ready', 'in_progress', 'done', 'canceled']).optional(),
        acceptanceCriteria: z.array(z.string().trim().min(3)).optional(),
      }),
      body,
    );
    return this.db.tenant(tenant, async (tx) => {
      const project = await loadProject(tx, tenant, projectId);
      const [story] = await tx.select().from(s.stories).where(and(eq(s.stories.id, uuidParam(storyId)), eq(s.stories.projectId, project.id)));
      if (!story) throw new NotFoundException();
      if (input.status && input.status !== story.status) {
        assertCan(tenant, actionForStatusChange(story.status, input.status), project.clientId);
        if (input.status === 'ready') {
          const [n] = await tx.select({ n: count() }).from(s.acceptanceCriteria).where(eq(s.acceptanceCriteria.storyId, story.id));
          const problems = readinessProblems({ description: input.description ?? story.description, acceptanceCriteriaCount: Number(n?.n ?? 0) });
          if (problems.length) {
            throw new BadRequestException({
              code: 'not_ready',
              problems,
              message: problems.includes('acceptance_criteria_missing')
                ? 'A story needs a description and at least one acceptance criterion before it can move to ready.'
                : 'A story needs a description before it can move to ready.',
            });
          }
        }
        await tx.update(s.stories).set({
          status: input.status as StoryStatus,
          startedAt: input.status === 'in_progress' ? new Date() : story.startedAt,
          doneAt: input.status === 'done' ? new Date() : story.doneAt,
          updatedAt: new Date(),
        }).where(eq(s.stories.id, story.id));
        await audit(tx, { agencyId: project.agencyId, actorId: tenant.userId, clientId: project.clientId, projectId: project.id, entityType: 'story', entityId: story.id, action: 'story.status_change', summary: `${story.key} moved from ${story.status.replace('_', ' ')} to ${input.status.replace('_', ' ')}` });
      }
      if (input.title || input.description) {
        assertCan(tenant, 'stories.prepare', project.clientId);
        await tx.update(s.stories).set({ title: input.title ?? story.title, description: input.description ?? story.description, updatedAt: new Date() }).where(eq(s.stories.id, story.id));
      }
      if (input.acceptanceCriteria) {
        assertCan(tenant, 'stories.prepare', project.clientId);
        await tx.delete(s.acceptanceCriteria).where(eq(s.acceptanceCriteria.storyId, story.id));
        if (input.acceptanceCriteria.length) {
          await tx.insert(s.acceptanceCriteria).values(input.acceptanceCriteria.map((statement, position) => ({ agencyId: project.agencyId, clientId: project.clientId, projectId: project.id, storyId: story.id, statement, position })));
        }
      }
      return { ok: true };
    });
  }
}
