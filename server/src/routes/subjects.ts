import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { subjects, academicSessions, works, files, recycleBin } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireNotSuspendedMiddleware } from '../auth/suspension.js';

export const subjectRoutes = Router();

// List subjects for a session
subjectRoutes.get('/api/sessions/:sessionId/subjects', async (req, res) => {
  const db = getDb();

  // Verify session ownership
  const [session] = await db
    .select({ id: academicSessions.id })
    .from(academicSessions)
    .where(and(
      eq(academicSessions.id, Number(req.params.sessionId)),
      eq(academicSessions.userId, req.userId),
    ))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const result = await db
    .select({
      id: subjects.id,
      sessionId: subjects.sessionId,
      userId: subjects.userId,
      name: subjects.name,
      createdAt: subjects.createdAt,
      updatedAt: subjects.updatedAt,
      work_count: sql<number>`(SELECT COUNT(*) FROM works WHERE subject_id = subjects.id)`,
      file_count: sql<number>`(SELECT COUNT(*) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = subjects.id)`,
      total_size: sql<number>`(SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = subjects.id)`,
    })
    .from(subjects)
    .where(eq(subjects.sessionId, Number(req.params.sessionId)))
    .orderBy(subjects.name);

  res.json({ 
    subjects: result.map((s: any) => ({
      ...s,
      work_count: Number(s.work_count || 0),
      file_count: Number(s.file_count || 0),
      total_size: Number(s.total_size || 0)
    }))
  });
});

// Get a single subject
subjectRoutes.get('/api/subjects/:id', async (req, res) => {
  const db = getDb();
  const [subject] = await db
    .select({
      id: subjects.id,
      sessionId: subjects.sessionId,
      userId: subjects.userId,
      name: subjects.name,
      createdAt: subjects.createdAt,
      updatedAt: subjects.updatedAt,
      session_name: sql<string>`(SELECT name FROM academic_sessions WHERE id = subjects.session_id)`,
      session_id: subjects.sessionId,
      work_count: sql<number>`(SELECT COUNT(*) FROM works WHERE subject_id = subjects.id)`,
      file_count: sql<number>`(SELECT COUNT(*) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = subjects.id)`,
      total_size: sql<number>`(SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = subjects.id)`,
    })
    .from(subjects)
    .where(and(
      eq(subjects.id, Number(req.params.id)),
      eq(subjects.userId, req.userId),
    ))
    .limit(1);

  if (!subject) {
    res.status(404).json({ error: 'Subject not found' });
    return;
  }

  res.json({ 
    subject: {
      ...subject,
      work_count: Number(subject.work_count || 0),
      file_count: Number(subject.file_count || 0),
      total_size: Number(subject.total_size || 0)
    }
  });
});

// Create subject
subjectRoutes.post('/api/sessions/:sessionId/subjects', requireNotSuspendedMiddleware, async (req, res) => {
  const { name } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Subject name is required' });
    return;
  }

  const db = getDb();

  const [session] = await db
    .select({ id: academicSessions.id })
    .from(academicSessions)
    .where(and(
      eq(academicSessions.id, Number(req.params.sessionId)),
      eq(academicSessions.userId, req.userId),
    ))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const [existing] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(
      eq(subjects.sessionId, Number(req.params.sessionId)),
      eq(subjects.name, String(name).trim()),
    ))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: 'A subject with this name already exists in this session' });
    return;
  }

  const [subject] = await db
    .insert(subjects)
    .values({
      sessionId: Number(req.params.sessionId),
      userId: req.userId,
      name: String(name).trim(),
    })
    .returning();

  res.status(201).json({ subject });
});

// Batch create subjects (for onboarding)
subjectRoutes.post('/api/sessions/:sessionId/subjects/batch', requireNotSuspendedMiddleware, async (req, res) => {
  const { names } = req.body;

  if (!names || !Array.isArray(names) || names.length === 0) {
    res.status(400).json({ error: 'At least one subject name is required' });
    return;
  }

  const db = getDb();

  const [session] = await db
    .select({ id: academicSessions.id })
    .from(academicSessions)
    .where(and(
      eq(academicSessions.id, Number(req.params.sessionId)),
      eq(academicSessions.userId, req.userId),
    ))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const created: typeof subjects.$inferSelect[] = [];
  const skipped: string[] = [];

  await db.transaction(async (tx: any) => {
    for (const name of names) {
      const trimmed = String(name).trim();
      if (!trimmed) continue;

      const inserted = await tx
        .insert(subjects)
        .values({
          sessionId: Number(req.params.sessionId),
          userId: req.userId,
          name: trimmed,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) {
        created.push(inserted[0]);
      } else {
        skipped.push(trimmed);
      }
    }
  });

  res.status(201).json({ created, skipped });
});

// Update subject
subjectRoutes.patch('/api/subjects/:id', async (req, res) => {
  const db = getDb();
  const [subject] = await db
    .select()
    .from(subjects)
    .where(and(
      eq(subjects.id, Number(req.params.id)),
      eq(subjects.userId, req.userId),
    ))
    .limit(1);

  if (!subject) {
    res.status(404).json({ error: 'Subject not found' });
    return;
  }

  const { name } = req.body;
  if (name !== undefined) {
    if (!String(name).trim()) {
      res.status(400).json({ error: 'Subject name cannot be empty' });
      return;
    }
    const [duplicate] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(
        eq(subjects.sessionId, subject.sessionId),
        eq(subjects.name, String(name).trim()),
        sql`${subjects.id} != ${Number(req.params.id)}`,
      ))
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: 'A subject with this name already exists' });
      return;
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (name !== undefined) updateData.name = String(name).trim();

  const [updated] = await db
    .update(subjects)
    .set(updateData)
    .where(eq(subjects.id, Number(req.params.id)))
    .returning();

  res.json({ subject: updated });
});

// Delete subject (soft delete)
subjectRoutes.delete('/api/subjects/:id', requireNotSuspendedMiddleware, async (req, res) => {
  const db = getDb();
  const [subject] = await db
    .select()
    .from(subjects)
    .where(and(
      eq(subjects.id, Number(req.params.id)),
      eq(subjects.userId, req.userId),
    ))
    .limit(1);

  if (!subject) {
    res.status(404).json({ error: 'Subject not found' });
    return;
  }

  const subjectWorks = await db.select().from(works).where(eq(works.subjectId, subject.id));
  const workIds = subjectWorks.map((w: any) => w.id);
  let subjectFiles: typeof files.$inferSelect[] = [];
  if (workIds.length > 0) {
    subjectFiles = await db
      .select()
      .from(files)
      .where(sql`${files.workId} IN (${sql.join(workIds.map((id: any) => sql`${id}`), sql`, `)})`);
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db.transaction(async (tx: any) => {
    await tx.insert(recycleBin).values({
      userId: req.userId,
      itemType: 'subject',
      itemId: subject.id,
      originalData: JSON.stringify({ subject, works: subjectWorks, files: subjectFiles }),
      expiresAt,
    });

    await tx.delete(subjects).where(eq(subjects.id, subject.id));
  });

  res.json({ success: true, message: 'Subject moved to recycle bin' });
});
