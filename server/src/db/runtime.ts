import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type Database = NodePgDatabase<typeof schema>;

let db: Database | undefined;
let pool: Pool | undefined;

/**
 * Initialize the PostgreSQL connection and run migrations.
 * The server will NOT start if migrations fail.
 */
export async function initDatabase(): Promise<Database> {
  if (db) return db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  pool = new Pool({ connectionString });

  // Verify connection before proceeding
  try {
    const client = await pool.connect();
    client.release();
    console.log('[db] PostgreSQL connection established');
  } catch (err) {
    console.error('[db] Failed to connect to PostgreSQL:', err);
    throw err;
  }

  db = drizzle(pool, { schema });

  // Run migrations — server blocks if this fails
  try {
    const migrationsFolder = path.join(__dirname, '..', '..', 'drizzle');
    await migrate(db, { migrationsFolder });
    console.log('[db] Migrations applied successfully');
  } catch (err) {
    console.error('[db] Migration failed — server will not start:', err);
    throw err;
  }

  return db;
}

/**
 * Get the initialized database instance.
 * Throws if called before initDatabase().
 */
export function getDb(): Database {
  if (!db) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection pool.
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
    console.log('[db] Database connection closed');
  }
}
