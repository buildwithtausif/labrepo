import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/runtime.js';
import { works, subjects, academicSessions, files } from '../db/schema.js';
import type { StorageAdapter } from '../storage/adapter.js';
import archiver from 'archiver';
import { eq, and } from 'drizzle-orm';

export function createDownloadRoutes(storage: StorageAdapter) {
  return async function downloadRoutes(fastify: FastifyInstance): Promise<void> {
    // Download entire work as ZIP
    fastify.get<{ Params: { id: string } }>('/api/download/work/:id', async (request, reply) => {
      const db = getDb();
      const [work] = await db
        .select({
          id: works.id,
          title: works.title,
          subject_name: subjects.name,
          session_name: academicSessions.name,
        })
        .from(works)
        .innerJoin(subjects, eq(works.subjectId, subjects.id))
        .innerJoin(academicSessions, eq(subjects.sessionId, academicSessions.id))
        .where(and(eq(works.id, Number(request.params.id)), eq(works.userId, request.userId)))
        .limit(1);

      if (!work) {
        return reply.status(404).send({ error: 'Work not found' });
      }

      const workFiles = await db.select().from(files).where(eq(files.workId, work.id));

      if (workFiles.length === 0) {
        return reply.status(404).send({ error: 'No files in this work' });
      }

      const zipName = `${work.title}.zip`;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      reply.raw.on('close', () => archive.destroy());

      for (const file of workFiles) {
        const { data } = await storage.download(file.storageKey);
        archive.append(data, { name: file.filename });
      }

      archive.finalize();
      return reply.send(archive);
    });

    // Download entire subject as ZIP
    fastify.get<{ Params: { id: string } }>('/api/download/subject/:id', async (request, reply) => {
      const db = getDb();
      const [subject] = await db
        .select({
          id: subjects.id,
          name: subjects.name,
          session_name: academicSessions.name,
        })
        .from(subjects)
        .innerJoin(academicSessions, eq(subjects.sessionId, academicSessions.id))
        .where(and(eq(subjects.id, Number(request.params.id)), eq(subjects.userId, request.userId)))
        .limit(1);

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const subjectWorks = await db.select().from(works).where(eq(works.subjectId, subject.id));

      const zipName = `${subject.name}.zip`;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      reply.raw.on('close', () => archive.destroy());

      for (const work of subjectWorks) {
        const workFiles = await db.select().from(files).where(eq(files.workId, work.id));
        for (const file of workFiles) {
          const { data } = await storage.download(file.storageKey);
          archive.append(data, { name: `${work.title}/${file.filename}` });
        }
      }

      archive.finalize();
      return reply.send(archive);
    });

    // Download entire session as ZIP
    fastify.get<{ Params: { id: string } }>('/api/download/session/:id', async (request, reply) => {
      const db = getDb();
      const [session] = await db
        .select()
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, Number(request.params.id)),
          eq(academicSessions.userId, request.userId),
        ))
        .limit(1);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const sessionSubjects = await db.select().from(subjects).where(eq(subjects.sessionId, session.id));

      const zipName = `${session.name}.zip`;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      reply.raw.on('close', () => archive.destroy());

      for (const subject of sessionSubjects) {
        const subjectWorks = await db.select().from(works).where(eq(works.subjectId, subject.id));
        for (const work of subjectWorks) {
          const workFiles = await db.select().from(files).where(eq(files.workId, work.id));
          for (const file of workFiles) {
            const { data } = await storage.download(file.storageKey);
            archive.append(data, {
              name: `${subject.name}/${work.title}/${file.filename}`,
            });
          }
        }
      }

      archive.finalize();
      return reply.send(archive);
    });

    // Download entire account as ZIP
    fastify.get('/api/download/all', async (request, reply) => {
      const db = getDb();
      const sessions = await db
        .select()
        .from(academicSessions)
        .where(eq(academicSessions.userId, request.userId));

      const zipName = 'labrepo-backup.zip';
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      reply.raw.on('close', () => archive.destroy());

      for (const session of sessions) {
        const sessionSubjects = await db.select().from(subjects).where(eq(subjects.sessionId, session.id));
        for (const subject of sessionSubjects) {
          const subjectWorks = await db.select().from(works).where(eq(works.subjectId, subject.id));
          for (const work of subjectWorks) {
            const workFiles = await db.select().from(files).where(eq(files.workId, work.id));
            for (const file of workFiles) {
              const { data } = await storage.download(file.storageKey);
              archive.append(data, {
                name: `${session.name}/${subject.name}/${work.title}/${file.filename}`,
              });
            }
          }
        }
      }

      archive.finalize();
      return reply.send(archive);
    });
  };
}
