import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error('DATABASE_OWNER_URL is required to run migrations');

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const { db, close } = createDb(url);

await migrate(db, { migrationsFolder });
await close();
console.log('Migrations applied');
