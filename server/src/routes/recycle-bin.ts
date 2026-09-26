import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/runtime.js';
import { recycleBin, academicSessions, subjects, works, files } from '../db/schema.js';
import type { StorageAdapter } from '../storage/adapter.js';
import { updateUserUsage } from '../services/usage.service.js';
import { eq, and, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/runtime.js';
import { requireNotSuspended } from '../auth/suspension.js';

export function createRecycleBinRoutes(storage: StorageAdapter) {
  return async function recycleBinRoutes(fastify: FastifyInstance): Promise<void> {
    // List recycle bin items
    fastify.get('/api/recycle-bin', async (request) => {
      const db = getDb();
      const items = await db
        .select()
        .from(recycleBin)
        .where(eq(recycleBin.userId, request.userId))
        .orderBy(sql`${recycleBin.deletedAt} DESC`);

      const now = Date.now();
      const enriched = items.map((item) => {
        const expiresAt = new Date(item.expiresAt).getTime();
        const remainingMs = Math.max(0, expiresAt - now);
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

        let data: any;
        try {
          data = JSON.parse(item.originalData);
        } catch {
          data = {};
        }

        let name = 'Unknown item';
        if (item.itemType === 'session' && data.session) name = data.session.name;
        else if (item.itemType === 'subject' && data.subject) name = data.subject.name;
        else if (item.itemType === 'work' && data.work) name = data.work.title;
        else if (item.itemType === 'file' && data.file) name = data.file.filename;

        return {
          id: item.id,
          item_type: item.itemType,
          item_id: item.itemId,
          name,
          deleted_at: item.deletedAt,
          expires_at: item.expiresAt,
          remaining_days: remainingDays,
        };
      });

      return { items: enriched };
    });

    // Restore item from recycle bin
    fastify.post<{ Params: { id: string } }>(
      '/api/recycle-bin/:id/restore',
      async (request, reply) => {
        if (await requireNotSuspended(request, reply)) return;

        const db = getDb();
        const [item] = await db
          .select()
          .from(recycleBin)
          .where(and(
            eq(recycleBin.id, Number(request.params.id)),
            eq(recycleBin.userId, request.userId),
          ))
          .limit(1);

        if (!item) {
          return reply.status(404).send({ error: 'Recycle bin item not found' });
        }

        let data: any;
        try {
          data = JSON.parse(item.originalData);
        } catch {
          return reply.status(500).send({ error: 'Could not parse item data' });
        }

        await db.transaction(async (tx) => {
          switch (item.itemType) {
            case 'session':
              await restoreSession(tx, data);
              break;
            case 'subject':
              await restoreSubject(tx, data);
              break;
            case 'work':
              await restoreWork(tx, data);
              break;
            case 'file':
              await restoreFile(tx, data);
              break;
          }

          await updateUserUsage({ userId: request.userId, timestamp: new Date().toISOString() });
          await tx.delete(recycleBin).where(eq(recycleBin.id, item.id));
        });

        return { success: true, message: `${item.itemType} restored successfully` };
      },
    );

    // Permanently delete from recycle bin
    fastify.delete<{ Params: { id: string } }>(
      '/api/recycle-bin/:id',
      async (request, reply) => {
        if (await requireNotSuspended(request, reply)) return;

        const db = getDb();
        const [item] = await db
          .select()
          .from(recycleBin)
          .where(and(
            eq(recycleBin.id, Number(request.params.id)),
            eq(recycleBin.userId, request.userId),
          ))
          .limit(1);

        if (!item) {
          return reply.status(404).send({ error: 'Recycle bin item not found' });
        }

        let data: any;
        try {
          data = JSON.parse(item.originalData);
        } catch {
          data = {};
        }

        const filesToDelete = extractFiles(item.itemType, data);
        let storageDelta = 0;
        let fileDelta = 0;

        for (const file of filesToDelete) {
          try {
            await storage.delete(file.storageKey || file.storage_key);
            storageDelta -= (file.sizeBytes || file.size_bytes || 0);
            fileDelta -= 1;
          } catch (error) {
            console.error(`Failed to delete file from storage: ${file.storageKey || file.storage_key}`, error);
            storageDelta -= (file.sizeBytes || file.size_bytes || 0);
            fileDelta -= 1;
          }
        }

        await db.delete(recycleBin).where(eq(recycleBin.id, item.id));

        if (storageDelta < 0 || fileDelta < 0) {
          await updateUserUsage({
            userId: request.userId,
            storageDelta,
            fileDelta,
          });
        }

        return { success: true, message: 'Permanently deleted' };
      },
    );
  };
}

async function restoreSession(tx: any, data: any): Promise<void> {
  const { session, subjects: subs, works: wks, files: fls } = data;

  // Use sql for overriding identity column
  await tx.execute(sql`
    INSERT INTO academic_sessions (id, user_id, name, auto_delete, auto_delete_date, created_at, updated_at)
    OVERRIDING SYSTEM VALUE
    VALUES (${session.id}, ${session.user_id || session.userId}, ${session.name}, ${session.auto_delete || session.autoDelete}, ${session.auto_delete_date || session.autoDeleteDate}, ${session.created_at || session.createdAt}, ${new Date().toISOString()})
  `);

  if (subs) {
    for (const sub of subs) {
      await tx.execute(sql`
        INSERT INTO subjects (id, session_id, user_id, name, created_at, updated_at)
        OVERRIDING SYSTEM VALUE
        VALUES (${sub.id}, ${sub.session_id || sub.sessionId}, ${sub.user_id || sub.userId}, ${sub.name}, ${sub.created_at || sub.createdAt}, ${new Date().toISOString()})
      `);
    }
  }

  if (wks) {
    for (const work of wks) {
      await tx.execute(sql`
        INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
        OVERRIDING SYSTEM VALUE
        VALUES (${work.id}, ${work.subject_id || work.subjectId}, ${work.user_id || work.userId}, ${work.title}, ${work.created_at || work.createdAt}, ${new Date().toISOString()})
      `);
    }
  }

  if (fls) {
    for (const file of fls) {
      await tx.execute(sql`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        OVERRIDING SYSTEM VALUE
        VALUES (${file.id}, ${file.work_id || file.workId}, ${file.user_id || file.userId}, ${file.filename}, ${file.sanitized_filename || file.sanitizedFilename}, ${file.extension}, ${file.size_bytes || file.sizeBytes}, ${file.storage_key || file.storageKey}, ${file.content_type || file.contentType}, ${file.created_at || file.createdAt})
      `);
    }
  }
}

async function restoreSubject(tx: any, data: any): Promise<void> {
  const { subject, works: wks, files: fls } = data;

  const [session] = await tx.select({ id: academicSessions.id }).from(academicSessions).where(eq(academicSessions.id, subject.session_id || subject.sessionId)).limit(1);
  if (!session) {
    throw new Error('Parent session no longer exists. Cannot restore.');
  }

  await tx.execute(sql`
    INSERT INTO subjects (id, session_id, user_id, name, created_at, updated_at)
    OVERRIDING SYSTEM VALUE
    VALUES (${subject.id}, ${subject.session_id || subject.sessionId}, ${subject.user_id || subject.userId}, ${subject.name}, ${subject.created_at || subject.createdAt}, ${new Date().toISOString()})
  `);

  if (wks) {
    for (const work of wks) {
      await tx.execute(sql`
        INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
        OVERRIDING SYSTEM VALUE
        VALUES (${work.id}, ${work.subject_id || work.subjectId}, ${work.user_id || work.userId}, ${work.title}, ${work.created_at || work.createdAt}, ${new Date().toISOString()})
      `);
    }
  }

  if (fls) {
    for (const file of fls) {
      await tx.execute(sql`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        OVERRIDING SYSTEM VALUE
        VALUES (${file.id}, ${file.work_id || file.workId}, ${file.user_id || file.userId}, ${file.filename}, ${file.sanitized_filename || file.sanitizedFilename}, ${file.extension}, ${file.size_bytes || file.sizeBytes}, ${file.storage_key || file.storageKey}, ${file.content_type || file.contentType}, ${file.created_at || file.createdAt})
      `);
    }
  }
}

async function restoreWork(tx: any, data: any): Promise<void> {
  const { work, files: fls } = data;

  const [subject] = await tx.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, work.subject_id || work.subjectId)).limit(1);
  if (!subject) {
    throw new Error('Parent subject no longer exists. Cannot restore.');
  }

  await tx.execute(sql`
    INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
    OVERRIDING SYSTEM VALUE
    VALUES (${work.id}, ${work.subject_id || work.subjectId}, ${work.user_id || work.userId}, ${work.title}, ${work.created_at || work.createdAt}, ${new Date().toISOString()})
  `);

  if (fls) {
    for (const file of fls) {
      await tx.execute(sql`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        OVERRIDING SYSTEM VALUE
        VALUES (${file.id}, ${file.work_id || file.workId}, ${file.user_id || file.userId}, ${file.filename}, ${file.sanitized_filename || file.sanitizedFilename}, ${file.extension}, ${file.size_bytes || file.sizeBytes}, ${file.storage_key || file.storageKey}, ${file.content_type || file.contentType}, ${file.created_at || file.createdAt})
      `);
    }
  }
}

async function restoreFile(tx: any, data: any): Promise<void> {
  const { file } = data;

  const [work] = await tx.select({ id: works.id }).from(works).where(eq(works.id, file.work_id || file.workId)).limit(1);
  if (!work) {
    throw new Error('Parent work no longer exists. Cannot restore.');
  }

  await tx.execute(sql`
    INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
    OVERRIDING SYSTEM VALUE
    VALUES (${file.id}, ${file.work_id || file.workId}, ${file.user_id || file.userId}, ${file.filename}, ${file.sanitized_filename || file.sanitizedFilename}, ${file.extension}, ${file.size_bytes || file.sizeBytes}, ${file.storage_key || file.storageKey}, ${file.content_type || file.contentType}, ${file.created_at || file.createdAt})
  `);
}

function extractFiles(itemType: string, data: any): any[] {
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
