import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client.js';
import * as s from './schema.js';

async function catalogPresent(db: Db): Promise<boolean> {
  const result = await db.execute(sql`select count(*)::int as count from plans`);
  return Number((result.rows[0] as { count: number }).count) > 0;
}

export async function resetDemo(db: Db) {
  await db.execute(sql`truncate table agencies, users, plans, hosting_tiers, cells, db_instances, templates, platform_articles,
    webhook_deliveries, operator_alerts, cost_reports, sandbox_resources, autonomous_evaluations restart identity cascade`);
}

/**
 * Loads the platform catalog only: plans, hosting tiers, the shared cell, and project templates.
 * Tenant rows (Agencies, people, Clients, projects) are created through the API.
 */
export async function seedDemo(db: Db, options: { reset?: boolean } = {}): Promise<'seeded' | 'skipped'> {
  if (options.reset) await resetDemo(db);
  else if (await catalogPresent(db)) return 'skipped';

  await db.transaction(async (tx) => {
    await seedCatalog(tx);
  });
  return 'seeded';
}

async function seedCatalog(tx: Tx) {
  await tx.insert(s.plans).values([
    { code: 'trial', name: 'Trial', seatCap: 5, clientCap: 2, trialDays: 14, monthlyPriceCents: 0, defaultSpendCapCents: 10_000 },
    { code: 'brand-starter', name: 'Brand Starter', seatCap: 10, clientCap: 1, trialDays: 14, monthlyPriceCents: 19_900, defaultSpendCapCents: 25_000 },
    { code: 'agency-growth', name: 'Agency Growth', seatCap: 25, clientCap: 10, trialDays: 14, monthlyPriceCents: 79_900, defaultSpendCapCents: 100_000 },
    { code: 'agency-scale', name: 'Agency Scale', seatCap: 100, clientCap: 50, trialDays: 14, monthlyPriceCents: 249_900, defaultSpendCapCents: 500_000 },
  ]);
  await tx.insert(s.hostingTiers).values([
    {
      code: 'starter', name: 'Starter', cpuMillicores: 250, memoryMb: 512, minReplicas: 1, maxReplicas: 3, databaseGb: 5, storageGb: 5,
      logRetentionDays: 7, bandwidthGb: 50, previewIdleMinutes: 30, monthlyPriceCents: 2_900, replicaHourCostCents: '0.9', replicaHourPriceCents: '2.0',
    },
    {
      code: 'standard', name: 'Standard', cpuMillicores: 500, memoryMb: 1024, minReplicas: 2, maxReplicas: 6, databaseGb: 20, storageGb: 20,
      logRetentionDays: 14, bandwidthGb: 250, previewIdleMinutes: 60, monthlyPriceCents: 9_900, replicaHourCostCents: '1.8', replicaHourPriceCents: '4.0',
    },
    {
      code: 'performance', name: 'Performance', cpuMillicores: 1000, memoryMb: 2048, minReplicas: 3, maxReplicas: 12, databaseGb: 100, storageGb: 50,
      logRetentionDays: 30, bandwidthGb: 1000, previewIdleMinutes: 120, monthlyPriceCents: 29_900, replicaHourCostCents: '3.6', replicaHourPriceCents: '7.5',
    },
  ]);
  await tx.insert(s.cells).values({
    id: 'cell-1',
    region: 'us-east-1',
    maxPods: 4000,
    usedPods: 0,
    maxNodes: 120,
    usedNodes: 0,
    maxIps: 16000,
    usedIps: 0,
  });
  await tx.insert(s.dbInstances).values([
    { cellId: 'cell-1', envClass: 'production', identifier: 'cell-1-prod-shared-1', maxDatabases: 60, databaseCount: 0 },
    { cellId: 'cell-1', envClass: 'nonproduction', identifier: 'cell-1-nonprod-shared-1', maxDatabases: 120, databaseCount: 0 },
  ]);
  await tx.insert(s.templates).values([
    {
      code: 'theme-os2',
      kind: 'theme',
      name: 'Online Store 2.0 theme',
      description: 'Dawn-based theme with Theme Check in CI and the preview pipeline wired to the Client store.',
      sourceRepo: 'higgsden-platform/template-theme-os2',
    },
    {
      code: 'app-react-router',
      kind: 'app',
      name: 'Shopify app (React Router)',
      description: "Shopify's React Router app template with a Dockerfile, buildspec.yml, and deployment manifests.",
      sourceRepo: 'higgsden-platform/template-app-react-router',
    },
  ]);
}
