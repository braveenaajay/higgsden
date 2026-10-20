import { createDb } from './client.js';
import { seedDemo } from './demo-data.js';

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error('DATABASE_OWNER_URL is required to seed');

const { db, close } = createDb(url);
try {
  const result = await seedDemo(db, { reset: process.env.SEED_RESET === 'true' });
  console.log(result === 'seeded' ? 'Platform catalog loaded' : 'Catalog already present, skipping. Set SEED_RESET=true to reload.');
} finally {
  await close();
}
