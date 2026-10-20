import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, withTenant, type Db } from './client.js';
import { resolveTeamsTenant } from './helpers.js';
import * as s from './schema.js';

/**
 * Proves row-level security without relying on seeded tenant rows.
 * Runs against Docker Postgres when DATABASE_URL is the app role.
 */
describe('agency isolation', () => {
  const url = process.env.DATABASE_URL;
  const skip = !url || url.includes('owner') || process.env.SKIP_ISOLATION === 'true';

  async function twoAgencies(db: Db) {
    const a = randomUUID();
    const b = randomUUID();
    await withTenant(db, { agencyId: a }, (tx) =>
      tx.insert(s.agencies).values({
        id: a,
        name: 'Isolation A',
        slug: `iso-a-${a.slice(0, 8)}`,
        planCode: 'trial',
        spendCapCents: 10_000,
      }),
    );
    await withTenant(db, { agencyId: b }, (tx) =>
      tx.insert(s.agencies).values({
        id: b,
        name: 'Isolation B',
        slug: `iso-b-${b.slice(0, 8)}`,
        planCode: 'trial',
        spendCapCents: 10_000,
      }),
    );
    return { a, b };
  }

  it.skipIf(skip)('hides another Agency\'s projects', async () => {
    const { db, close } = createDb(url!);
    try {
      const { a, b } = await twoAgencies(db);
      const [clientA] = await withTenant(db, { agencyId: a }, (tx) =>
        tx.insert(s.clients).values({ agencyId: a, name: 'Client A' }).returning(),
      );
      await withTenant(db, { agencyId: a }, (tx) =>
        tx.insert(s.projects).values({ agencyId: a, clientId: clientA!.id, key: `A${a.slice(0, 4).toUpperCase()}`, name: 'Project A' }),
      );
      const aProjects = await withTenant(db, { agencyId: a }, (tx) =>
        tx.select({ id: s.projects.id, agencyId: s.projects.agencyId }).from(s.projects),
      );
      const bProjects = await withTenant(db, { agencyId: b }, (tx) =>
        tx.select({ id: s.projects.id, agencyId: s.projects.agencyId }).from(s.projects),
      );
      expect(aProjects.every((p) => p.agencyId === a)).toBe(true);
      expect(aProjects.length).toBeGreaterThan(0);
      expect(bProjects.some((p) => aProjects.some((row) => row.id === p.id))).toBe(false);
      const none = await withTenant(db, {}, (tx) => tx.select({ id: s.projects.id }).from(s.projects));
      expect(none).toEqual([]);
    } finally {
      await close();
    }
  });

  it.skipIf(skip)('hides another Agency\'s Teams transcripts and questions', async () => {
    const { db, close } = createDb(url!);
    try {
      const { a, b } = await twoAgencies(db);
      const [connA] = await withTenant(db, { agencyId: a }, (tx) =>
        tx
          .insert(s.teamsConnections)
          .values({ agencyId: a, entraTenantId: `tenant-${a}`, mode: 'fake' })
          .returning(),
      );
      await withTenant(db, { agencyId: a }, (tx) =>
        tx.insert(s.meetingTranscripts).values({
          agencyId: a,
          connectionId: connA!.id,
          graphMeetingId: `meet-${a}`,
          graphTranscriptId: `tr-${a}`,
          organizerEntraUserId: 'organizer-a',
          subject: 'Secret A',
          rawText: 'WEBVTT\nWho owns this?\n',
        }),
      );
      const aTranscripts = await withTenant(db, { agencyId: a }, (tx) =>
        tx.select({ id: s.meetingTranscripts.id, agencyId: s.meetingTranscripts.agencyId }).from(s.meetingTranscripts),
      );
      const bTranscripts = await withTenant(db, { agencyId: b }, (tx) =>
        tx.select({ id: s.meetingTranscripts.id }).from(s.meetingTranscripts),
      );
      expect(aTranscripts.every((row) => row.agencyId === a)).toBe(true);
      expect(aTranscripts.length).toBe(1);
      expect(bTranscripts.some((row) => aTranscripts.some((x) => x.id === row.id))).toBe(false);
    } finally {
      await close();
    }
  });

  it.skipIf(skip)('resolves a Teams tenant id to one Agency', async () => {
    const { db, close } = createDb(url!);
    try {
      const { a, b } = await twoAgencies(db);
      await withTenant(db, { agencyId: a }, (tx) =>
        tx.insert(s.teamsConnections).values({ agencyId: a, entraTenantId: `resolve-${a}`, mode: 'fake' }),
      );
      await withTenant(db, { agencyId: b }, (tx) =>
        tx.insert(s.teamsConnections).values({ agencyId: b, entraTenantId: `resolve-${b}`, mode: 'fake' }),
      );
      const north = await withTenant(db, {}, (tx) => resolveTeamsTenant(tx, `resolve-${a}`));
      const lumen = await withTenant(db, {}, (tx) => resolveTeamsTenant(tx, `resolve-${b}`));
      const missing = await withTenant(db, {}, (tx) => resolveTeamsTenant(tx, 'does-not-exist'));
      expect(north).toBe(a);
      expect(lumen).toBe(b);
      expect(missing).toBeNull();
    } finally {
      await close();
    }
  });

  it.skipIf(skip)('rejects a duplicate Graph transcript id in the same Agency', async () => {
    const { db, close } = createDb(url!);
    try {
      const agencyId = randomUUID();
      await withTenant(db, { agencyId }, (tx) =>
        tx.insert(s.agencies).values({
          id: agencyId,
          name: 'Dup Agency',
          slug: `dup-${agencyId.slice(0, 8)}`,
          planCode: 'trial',
          spendCapCents: 10_000,
        }),
      );
      const [connection] = await withTenant(db, { agencyId }, (tx) =>
        tx.insert(s.teamsConnections).values({ agencyId, entraTenantId: `dup-${agencyId}`, mode: 'fake' }).returning(),
      );
      const transcriptId = `tr-dup-${agencyId}`;
      await withTenant(db, { agencyId }, (tx) =>
        tx.insert(s.meetingTranscripts).values({
          agencyId,
          connectionId: connection!.id,
          graphMeetingId: 'meet-1',
          graphTranscriptId: transcriptId,
          organizerEntraUserId: 'org',
          subject: 'first',
          rawText: 'WEBVTT\n',
        }),
      );
      await expect(
        withTenant(db, { agencyId }, (tx) =>
          tx.insert(s.meetingTranscripts).values({
            agencyId,
            connectionId: connection!.id,
            graphMeetingId: 'meet-2',
            graphTranscriptId: transcriptId,
            organizerEntraUserId: 'org',
            subject: 'duplicate',
            rawText: 'WEBVTT\n',
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });
});

describe('operator cannot read meeting content', () => {
  const url = process.env.DATABASE_OPERATOR_URL;
  const skip = !url || process.env.SKIP_ISOLATION === 'true';

  it.skipIf(skip)('denies select on meeting_transcripts and meeting_questions', async () => {
    const { db, close } = createDb(url!);
    try {
      await expect(db.select().from(s.meetingTranscripts)).rejects.toThrow();
      await expect(db.select().from(s.meetingQuestions)).rejects.toThrow();
      const overview = await db.execute<{ agency_id: string; teams_connected: boolean }>(sql`select * from operator_agency_overview()`);
      expect(overview.rows.every((row) => typeof row.teams_connected === 'boolean')).toBe(true);
    } finally {
      await close();
    }
  });
});
