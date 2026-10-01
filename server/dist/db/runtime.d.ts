import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
export type Database = NodePgDatabase<typeof schema>;
/**
 * Initialize the PostgreSQL connection and run migrations.
 * The server will NOT start if migrations fail.
 */
export declare function initDatabase(): Promise<Database>;
/**
 * Get the initialized database instance.
 * Throws if called before initDatabase().
 */
export declare function getDb(): Database;
/**
 * Close the database connection pool.
 */
export declare function closeDatabase(): Promise<void>;
