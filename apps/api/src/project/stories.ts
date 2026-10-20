import { audit, enqueue, schema as s, type Tx } from '@higgsden/db';
import { eq, sql } from 'drizzle-orm';
import type { ProjectRow } from '../common/access.js';

export interface NewStory {
  title: string;
  description?: string;
  epicId?: string | null;
  milestoneId?: string | null;
  requirementId?: string | null;
  decisionId?: string | null;
  estimate?: number | null;
  acceptanceCriteria?: string[];
}

/** Every path that creates a story goes through here, so keys, criteria, audit, and indexing stay consistent. */
export async function createStory(tx: Tx, actor: { userId: string | null; kind?: 'member' | 'agent' | 'system' }, project: ProjectRow, input: NewStory) {
  const [numbered] = await tx
    .update(s.projects)
    .set({ nextStoryNumber: sql`${s.projects.nextStoryNumber} + 1` })
    .where(eq(s.projects.id, project.id))
    .returning({ next: s.projects.nextStoryNumber });
  const key = `${project.key}-${numbered!.next - 1}`;
  const scope = { agencyId: project.agencyId, clientId: project.clientId, projectId: project.id };
  const [story] = await tx
    .insert(s.stories)
    .values({
      ...scope,
      key,
      title: input.title,
      description: input.description ?? '',
      epicId: input.epicId ?? null,
      milestoneId: input.milestoneId ?? null,
      requirementId: input.requirementId ?? null,
      decisionId: input.decisionId ?? null,
      estimate: input.estimate == null ? null : String(input.estimate),
    })
    .returning();
  const criteria = (input.acceptanceCriteria ?? []).map((c) => c.trim()).filter(Boolean);
  if (criteria.length) {
    await tx.insert(s.acceptanceCriteria).values(criteria.map((statement, position) => ({ ...scope, storyId: story!.id, statement, position })));
  }
  await audit(tx, {
    ...scope,
    actorId: actor.userId,
    actorKind: actor.kind,
    entityType: 'story',
    entityId: story!.id,
    action: 'story.create',
    summary: `Created ${key} ${input.title}`,
  });
  await reindex(tx, project.agencyId, 'story', story!.id);
  return story!;
}

/** Queues the knowledge index to refresh one source record. */
export function reindex(tx: Tx, agencyId: string, sourceType: 'story' | 'note' | 'decision' | 'requirement' | 'resolution', sourceId: string) {
  return enqueue(tx, agencyId, 'indexing', 'index.source', { agencyId, sourceType, sourceId });
}

/** Publishes a domain event for the automation engine. */
export function emitEvent(tx: Tx, agencyId: string, type: string, data: Record<string, unknown>) {
  return enqueue(tx, agencyId, 'events', type, { agencyId, type, ...data });
}
