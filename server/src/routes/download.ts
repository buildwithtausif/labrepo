import { Router } from 'express';
import { getDb } from '../../db/runtime.js';
import { works, subjects, academicSessions, files } from '../../db/schema.js';
import type { StorageResolverFn } from '../files.js';
import archiver from 'archiver';
import { eq, and } from 'drizzle-orm';

export function createDownloadRoutes(resolveStorage: StorageResolverFn) {
  const router = Router();

  // Download entire work as ZIP
  router.get('/api/download/work/:id', async (req, res) => {
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
      .where(and(eq(works.id, Number(req.params.id)), eq(works.userId, req.userId)))
      .limit(1);

    if (!work) {
      res.status(404).json({ error: 'Work not found' });
      return;
    }

    const workFiles = await db.select().from(files).where(eq(files.workId, work.id));

    if (workFiles.length === 0) {
      res.status(404).json({ error: 'No files in this work' });
      return;
    }

    const zipName = `${work.title}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`
    });

    const archive = archiver('zip', { zlib: { level: 5 } });
    
    // Pipe archive data to the response
    archive.pipe(res);

    const storage = await resolveStorage(req.userId);

    for (const file of workFiles) {
      const { data } = await storage.download(file.storageKey);
      archive.append(data, { name: file.filename });
    }

    archive.finalize();
  });

  // Download entire subject as ZIP
  router.get('/api/download/subject/:id', async (req, res) => {
    const db = getDb();
    const [subject] = await db
      .select({
        id: subjects.id,
        name: subjects.name,
        session_name: academicSessions.name,
      })
      .from(subjects)
      .innerJoin(academicSessions, eq(subjects.sessionId, academicSessions.id))
      .where(and(eq(subjects.id, Number(req.params.id)), eq(subjects.userId, req.userId)))
      .limit(1);

    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const subjectWorks = await db.select().from(works).where(eq(works.subjectId, subject.id));

    const zipName = `${subject.name}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`
    });

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    const storage = await resolveStorage(req.userId);

    for (const work of subjectWorks) {
      const workFiles = await db.select().from(files).where(eq(files.workId, work.id));
      for (const file of workFiles) {
        const { data } = await storage.download(file.storageKey);
        archive.append(data, { name: `${work.title}/${file.filename}` });
      }
    }

    archive.finalize();
  });

  // Download entire session as ZIP
  router.get('/api/download/session/:id', async (req, res) => {
    const db = getDb();
    const [session] = await db
      .select()
      .from(academicSessions)
      .where(and(
        eq(academicSessions.id, Number(req.params.id)),
        eq(academicSessions.userId, req.userId),
      ))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const sessionSubjects = await db.select().from(subjects).where(eq(subjects.sessionId, session.id));

    const zipName = `${session.name}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`
    });

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    const storage = await resolveStorage(req.userId);

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
  });

  // Download entire account as ZIP
  router.get('/api/download/all', async (req, res) => {
    const db = getDb();
    const sessions = await db
      .select()
      .from(academicSessions)
      .where(eq(academicSessions.userId, req.userId));

    const zipName = 'labrepo-backup.zip';
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`
    });

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    const storage = await resolveStorage(req.userId);

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
  });

  return router;
}
