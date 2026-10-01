import type { StorageAdapter } from '../storage/adapter.js';
/**
 * Cleanup job — runs periodically to:
 * 1. Permanently delete expired recycle bin items (7 days)
 * 2. Auto-delete academic sessions past their auto_delete_date
 */
export declare function startCleanupJob(storage: StorageAdapter): void;
