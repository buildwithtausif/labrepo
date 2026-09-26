import { getDb } from '../db/runtime.js';
import { recycleBin, academicSessions, subjects, works, files } from '../db/schema.js';
import type { StorageAdapter } from '../storage/adapter.js';
import { eq, lte, and, sql } from 'drizzle-orm';
import { updateUserUsage } from '../services/usage.service.js';

/**
 * Cleanup job — runs periodically to:
 * 1. Permanently delete expired recycle bin items (7 days)
 * 2. Auto-delete academic sessions past their auto_delete_date
 */
export function startCleanupJob(storage: StorageAdapter): void {
  // Run immediately on startup
  runCleanup(storage).catch(console.error);

  // Then run every hour
  setInterval(() => {
    runCleanup(storage).catch(console.error);
  }, 60 * 60 * 1000);
}

async function runCleanup(storage: StorageAdapter): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  // 1. Clean expired recycle bin items
  const expiredItems = await db
    .select()
    .from(recycleBin)
    .where(lte(recycleBin.expiresAt, now));

  for (const item of expiredItems) {
    let data: any;
    try {
      data = JSON.parse(item.originalData);
    } catch {
      continue;
    }

    const filesToDelete = extractAllFiles(item.itemType, data);
    let storageDelta = 0;
    let fileDelta = 0;

    for (const file of filesToDelete) {
      try {
        await storage.delete(file.storage_key || file.storageKey);
        storageDelta -= (file.sizeBytes || file.size_bytes || 0);
        fileDelta -= 1;
      } catch (err) {
        console.error(`Failed to delete storage key ${file.storage_key || file.storageKey}:`, err);
        storageDelta -= (file.sizeBytes || file.size_bytes || 0);
        fileDelta -= 1;
      }
    }

    await db.delete(recycleBin).where(eq(recycleBin.id, item.id));

    if (storageDelta < 0 || fileDelta < 0) {
      await updateUserUsage({
        userId: item.userId,
        storageDelta,
        fileDelta,
      });
    }
  }

  if (expiredItems.length > 0) {
    console.log(`[cleanup] Permanently deleted ${expiredItems.length} expired recycle bin items`);
  }

  // 2. Auto-delete sessions past their auto_delete_date
  const today = now.split('T')[0];
  const expiredSessions = await db
    .select()
    .from(academicSessions)
    .where(and(
      eq(academicSessions.autoDelete, 1),
      sql`${academicSessions.autoDeleteDate} IS NOT NULL`,
      lte(academicSessions.autoDeleteDate, today),
    ));

  for (const session of expiredSessions) {
    const sessionSubjects = await db.select().from(subjects).where(eq(subjects.sessionId, session.id));
    const subjectIds = sessionSubjects.map((s) => s.id);

    let sessionWorks: typeof works.$inferSelect[] = [];
    let sessionFiles: typeof files.$inferSelect[] = [];

    if (subjectIds.length > 0) {
      sessionWorks = await db
        .select()
        .from(works)
        .where(sql`${works.subjectId} IN (${sql.join(subjectIds.map(id => sql`${id}`), sql`, `)})`);

      const workIds = sessionWorks.map((w) => w.id);
      if (workIds.length > 0) {
        sessionFiles = await db
          .select()
          .from(files)
          .where(sql`${files.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`);
      }
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.transaction(async (tx) => {
      await tx.insert(recycleBin).values({
        userId: session.userId,
        itemType: 'session',
        itemId: session.id,
        originalData: JSON.stringify({ session, subjects: sessionSubjects, works: sessionWorks, files: sessionFiles }),
        expiresAt,
      });

      await tx.delete(academicSessions).where(eq(academicSessions.id, session.id));
    });

    console.log(`[cleanup] Auto-deleted session "${session.name}" for user ${session.userId}`);
  }
}

function extractAllFiles(itemType: string, data: any): any[] {
  switch (itemType) {
    case 'file':
      return data.file ? [data.file] : [];
    case 'work':
    case 'subject':
    case 'session':
      return data.files || [];
    default:
      return [];
  }
}
