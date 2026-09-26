import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initializeSchema } from './schema.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'labrepo.db');
let db;
export function initDb() {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    // Enable WAL mode for better concurrent performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Initialize schema
    initializeSchema(db);
    return db;
}
export function getDb() {
    if (!db) {
        return initDb();
    }
    return db;
}
export function closeDb() {
    if (db) {
        db.close();
    }
}
