import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { works, subjects, academicSessions, files } from '../db/schema.js';
import type { StorageResolverFn } from './files.js';
import archiver from 'archiver';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs_node from 'fs';

interface DownloadJob {
  id: string;
  userId: string;
  status: 'preparing' | 'ready' | 'error';
  progress: number;
  total: number;
  error?: string;
  zipPath: string;
  zipName: string;
}

const jobs = new Map<string, DownloadJob>();

export function createDownloadRoutes(resolveStorage: StorageResolverFn) {
  const router = Router();

  async function startJob(userId: string, zipName: string, getFilesToZip: () => Promise<{name: string, storageKey: string}[]>) {
    const jobId = crypto.randomUUID();
    const zipPath = path.join(os.tmpdir(), `labrepo_dl_${jobId}.zip`);
    
    jobs.set(jobId, {
      id: jobId,
      userId,
      status: 'preparing',
      progress: 0,
      total: 0, // will update
      zipPath,
      zipName
    });

    // Run in background
    Promise.resolve().then(async () => {
      const job = jobs.get(jobId)!;
      try {
        const filesToZip = await getFilesToZip();
        job.total = filesToZip.length;
        
        if (filesToZip.length === 0) {
          throw new Error('No files found');
        }

        const output = fs_node.createWriteStream(job.zipPath);
        const archive = archiver('zip', { zlib: { level: 5 } });

        archive.pipe(output);
        const storage = await resolveStorage(userId);

        for (let i = 0; i < filesToZip.length; i++) {
          const file = filesToZip[i];
          try {
            const { data } = await storage.download(file.storageKey);
            archive.append(data, { name: file.name });
          } catch (err) {
            console.error(`Failed to download ${file.name} for zip`, err);
          }
          job.progress = i + 1;
        }

        await archive.finalize();

        await new Promise<void>((resolve, reject) => {
          output.on('close', () => resolve());
          output.on('error', reject);
        });

        job.status = 'ready';
      } catch (err: any) {
        job.status = 'error';
        job.error = err.message || 'Unknown error';
      }
    });

    return jobId;
  }

  router.post('/api/download/prepare/work/:id', async (req, res) => {
    const db = getDb();
    const [work] = await db
      .select({
        id: works.id,
        title: works.title,
      })
      .from(works)
      .where(and(eq(works.id, Number(req.params.id)), eq(works.userId, req.userId)))
      .limit(1);

    if (!work) {
      res.status(404).json({ error: 'Work not found' });
      return;
    }

    const jobId = await startJob(req.userId, `${work.title}.zip`, async () => {
      const workFiles = await db.select().from(files).where(eq(files.workId, work.id));
      return workFiles.map(f => ({ name: f.filename, storageKey: f.storageKey }));
    });

    res.json({ jobId });
  });

  router.post('/api/download/prepare/subject/:id', async (req, res) => {
    const db = getDb();
    const [subject] = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(and(eq(subjects.id, Number(req.params.id)), eq(subjects.userId, req.userId)))
      .limit(1);

    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const jobId = await startJob(req.userId, `${subject.name}.zip`, async () => {
      const subjectWorks = await db.select().from(works).where(eq(works.subjectId, subject.id));
      const allFiles = [];
      for (const w of subjectWorks) {
        const wFiles = await db.select().from(files).where(eq(files.workId, w.id));
        allFiles.push(...wFiles.map(f => ({ name: `${w.title}/${f.filename}`, storageKey: f.storageKey })));
      }
      return allFiles;
    });

    res.json({ jobId });
  });

  router.post('/api/download/prepare/session/:id', async (req, res) => {
    const db = getDb();
    const [session] = await db
      .select()
      .from(academicSessions)
      .where(and(eq(academicSessions.id, Number(req.params.id)), eq(academicSessions.userId, req.userId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const jobId = await startJob(req.userId, `${session.name}.zip`, async () => {
      const sessionSubjects = await db.select().from(subjects).where(eq(subjects.sessionId, session.id));
      const allFiles = [];
      for (const s of sessionSubjects) {
        const sWorks = await db.select().from(works).where(eq(works.subjectId, s.id));
        for (const w of sWorks) {
          const wFiles = await db.select().from(files).where(eq(files.workId, w.id));
          allFiles.push(...wFiles.map(f => ({ name: `${s.name}/${w.title}/${f.filename}`, storageKey: f.storageKey })));
        }
      }
      return allFiles;
    });

    res.json({ jobId });
  });

  router.post('/api/download/prepare/all', async (req, res) => {
    const db = getDb();
    const jobId = await startJob(req.userId, 'labrepo-backup.zip', async () => {
      const sessions = await db.select().from(academicSessions).where(eq(academicSessions.userId, req.userId));
      const allFiles = [];
      for (const session of sessions) {
        const sessionSubjects = await db.select().from(subjects).where(eq(subjects.sessionId, session.id));
        for (const subject of sessionSubjects) {
          const subjectWorks = await db.select().from(works).where(eq(works.subjectId, subject.id));
          for (const work of subjectWorks) {
            const workFiles = await db.select().from(files).where(eq(files.workId, work.id));
            allFiles.push(...workFiles.map(f => ({ name: `${session.name}/${subject.name}/${work.title}/${f.filename}`, storageKey: f.storageKey })));
          }
        }
      }
      return allFiles;
    });

    res.json({ jobId });
  });

  router.get('/api/download/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.userId !== req.userId) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({
      status: job.status,
      progress: job.progress,
      total: job.total,
      error: job.error,
    });
  });

  router.get('/api/download/file/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.userId !== req.userId || job.status !== 'ready') {
      res.status(404).json({ error: 'File not ready or not found' });
      return;
    }

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${job.zipName}"`
    });

    const stream = fs_node.createReadStream(job.zipPath);
    stream.pipe(res);

    stream.on('end', () => {
      // Clean up after 5 minutes
      setTimeout(() => {
        try { fs_node.unlinkSync(job.zipPath); jobs.delete(job.id); } catch(e){}
      }, 1000 * 60 * 5);
    });
  });

  return router;
}
