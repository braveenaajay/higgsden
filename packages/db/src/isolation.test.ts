import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, withTenant } from './client.js';
import { resolveTeamsTenant } from './helpers.js';
import * as s from './schema.js';

/**
 * Proves row-level security: an Agency A transaction cannot read Agency B's projects.
 * Runs against the dockerised database when DATABASE_URL is the app role.
 */
describe('agency isolation', () => {
  const url = process.env.DATABASE_URL;
  const skip = !url || url.includes('owner') || process.env.SKIP_ISOLATION === 'true';

  it.skipIf(skip)('hides another Agency\'s projects', async () => {
    const { db, close } = createDb(url!);
    try {
      const agencies = await withTenant(db, {}, async (tx) => {
        const result = await tx.execute<{ id: string }>(sql`select list_agency_ids() as id`);
        return result.rows.map((r) => r.id);
      });
      expect(agencies.length).toBeGreaterThanOrEqual(2);
      const [a, b] = agencies;
      const aProjects = await withTenant(db, { agencyId: a }, (tx) => tx.select({ id: s.projects.id, agencyId: s.projects.agencyId }).from(s.projects));
      const bProjects = await withTenant(db, { agencyId: b }, (tx) => tx.select({ id: s.projects.id, agencyId: s.projects.agencyId }).from(s.projects));
      expect(aProjects.every((p) => p.agencyId === a)).toBe(true);
      expect(bProjects.every((p) => p.agencyId === b)).toBe(true);
      const aIds = new Set(aProjects.map((p) => p.id));
      expect(bProjects.some((p) => aIds.has(p.id))).toBe(false);
      const none = await withTenant(db, {}, (tx) => tx.select({ id: s.projects.id }).from(s.projects));
      expect(none).toEqual([]);
    } finally {
      await close();
    }
  });

  it.skipIf(skip)('hides another Agency\'s Teams transcripts and questions', async () => {
    const { db, close } = createDb(url!);
    try {
      const agencies = await withTenant(db, {}, async (tx) => {
        const result = await tx.execute<{ id: string }>(sql`select list_agency_ids() as id`);
        return result.rows.map((r) => r.id);
      });
      const [a, b] = agencies;
      const aTranscripts = await withTenant(db, { agencyId: a }, (tx) =>
        tx.select({ id: s.meetingTranscripts.id, agencyId: s.meetingTranscripts.agencyId, rawText: s.meetingTranscripts.rawText }).from(s.meetingTranscripts),
      );
      const bTranscripts = await withTenant(db, { agencyId: b }, (tx) =>
        tx.select({ id: s.meetingTranscripts.id, agencyId: s.meetingTranscripts.agencyId }).from(s.meetingTranscripts),
      );
      expect(aTranscripts.every((row) => row.agencyId === a)).toBe(true);
      expect(bTranscripts.every((row) => row.agencyId === b)).toBe(true);
      const aIds = new Set(aTranscripts.map((row) => row.id));
      expect(bTranscripts.some((row) => aIds.has(row.id))).toBe(false);

      const aQuestions = await withTenant(db, { agencyId: a }, (tx) =>
        tx.select({ id: s.meetingQuestions.id, quote: s.meetingQuestions.quote, agencyId: s.meetingQuestions.agencyId }).from(s.meetingQuestions),
      );
      const bQuestions = await withTenant(db, { agencyId: b }, (tx) =>
        tx.select({ id: s.meetingQuestions.id }).from(s.meetingQuestions),
      );
      expect(aQuestions.every((row) => row.agencyId === a)).toBe(true);
      if (aQuestions.length) expect(bQuestions).toEqual([]);

      const none = await withTenant(db, {}, (tx) => tx.select({ id: s.meetingTranscripts.id }).from(s.meetingTranscripts));
      expect(none).toEqual([]);
    } finally {
      await close();
    }
  });

  it.skipIf(skip)('resolves a Teams tenant id to one Agency', async () => {
    const { db, close } = createDb(url!);
    try {
      const northwind = await withTenant(db, {}, (tx) => resolveTeamsTenant(tx, 'fake-northwind-tenant'));
      const lumen = await withTenant(db, {}, (tx) => resolveTeamsTenant(tx, 'fake-lumen-tenant'));
      const missing = await withTenant(db, {}, (tx) => resolveTeamsTenant(tx, 'does-not-exist'));
      expect(northwind).toBeTruthy();
      expect(lumen).toBeTruthy();
      expect(northwind).not.toBe(lumen);
      expect(missing).toBeNull();
    } finally {
      await close();
    }
  });

  it.skipIf(skip)('rejects a duplicate Graph transcript id in the same Agency', async () => {
    const { db, close } = createDb(url!);
    try {
      const agencyId = await withTenant(db, {}, (tx) => resolveTeamsTenant(tx, 'fake-northwind-tenant'));
      expect(agencyId).toBeTruthy();
      const [existing] = await withTenant(db, { agencyId: agencyId! }, (tx) => tx.select().from(s.meetingTranscripts).limit(1));
      expect(existing).toBeTruthy();
      await expect(
        withTenant(db, { agencyId: agencyId! }, (tx) =>
          tx.insert(s.meetingTranscripts).values({
            agencyId: agencyId!,
            connectionId: existing!.connectionId,
            graphMeetingId: 'dup-meeting',
            graphTranscriptId: existing!.graphTranscriptId,
            organizerEntraUserId: existing!.organizerEntraUserId,
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
      expect(overview.rows.some((row) => row.teams_connected)).toBe(true);
      expect(overview.rows.every((row) => typeof row.teams_connected === 'boolean')).toBe(true);
    } finally {
      await close();
    }
  });
});
