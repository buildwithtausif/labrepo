import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { academicSessions, subjects, works, files, recycleBin } from '../db/schema.js';
import { eq, and, sql, count } from 'drizzle-orm';
import { requireNotSuspendedMiddleware } from '../auth/suspension.js';

export const sessionRoutes = Router();

// List all academic sessions for the user
sessionRoutes.get('/api/sessions', async (req, res) => {
  const db = getDb();

  const sessions = await db
    .select({
      id: academicSessions.id,
      userId: academicSessions.userId,
      name: academicSessions.name,
      autoDelete: academicSessions.autoDelete,
      autoDeleteDate: academicSessions.autoDeleteDate,
      createdAt: academicSessions.createdAt,
      updatedAt: academicSessions.updatedAt,
      subject_count: sql<number>`(SELECT COUNT(*) FROM subjects WHERE session_id = academic_sessions.id)`,
      file_count: sql<number>`(SELECT COUNT(*) FROM files f JOIN works w ON f.work_id = w.id JOIN subjects sub ON w.subject_id = sub.id WHERE sub.session_id = academic_sessions.id)`,
    })
    .from(academicSessions)
    .where(eq(academicSessions.userId, req.userId))
    .orderBy(sql`${academicSessions.createdAt} DESC`);

  res.json({ 
    sessions: sessions.map((s: any) => ({
      ...s,
      subject_count: Number(s.subject_count || 0),
      file_count: Number(s.file_count || 0)
    }))
  });
});

// Get a single session
sessionRoutes.get('/api/sessions/:id', async (req, res) => {
  const db = getDb();

  const [session] = await db
    .select({
      id: academicSessions.id,
      userId: academicSessions.userId,
      name: academicSessions.name,
      autoDelete: academicSessions.autoDelete,
      autoDeleteDate: academicSessions.autoDeleteDate,
      createdAt: academicSessions.createdAt,
      updatedAt: academicSessions.updatedAt,
      subject_count: sql<number>`(SELECT COUNT(*) FROM subjects WHERE session_id = academic_sessions.id)`,
      file_count: sql<number>`(SELECT COUNT(*) FROM files f JOIN works w ON f.work_id = w.id JOIN subjects sub ON w.subject_id = sub.id WHERE sub.session_id = academic_sessions.id)`,
    })
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

  res.json({ 
    session: {
      ...session,
      subject_count: Number(session.subject_count || 0),
      file_count: Number(session.file_count || 0)
    }
  });
});

// Create academic session
sessionRoutes.post('/api/sessions', requireNotSuspendedMiddleware, async (req, res) => {
  const { name, auto_delete, auto_delete_date } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Session name is required' });
    return;
  }

  const db = getDb();

  // Check for duplicate name
  const [existing] = await db
    .select({ id: academicSessions.id })
    .from(academicSessions)
    .where(and(
      eq(academicSessions.userId, req.userId),
      eq(academicSessions.name, String(name).trim()),
    ))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: 'A session with this name already exists' });
    return;
  }

  let deleteDate = auto_delete_date || null;
  if (auto_delete && !deleteDate) {
    const yearMatch = String(name).match(/(\d{4})\s*[-–]\s*(\d{4})/);
    if (yearMatch) {
      deleteDate = `${yearMatch[2]}-07-31`;
    }
  }

  const [session] = await db
    .insert(academicSessions)
    .values({
      userId: req.userId,
      name: String(name).trim(),
      autoDelete: auto_delete ? 1 : 0,
      autoDeleteDate: deleteDate,
    })
    .returning();

  res.status(201).json({ session });
});

// Update academic session
sessionRoutes.patch('/api/sessions/:id', async (req, res) => {
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

  const { name, auto_delete, auto_delete_date } = req.body;

  if (name !== undefined) {
    if (!String(name).trim()) {
      res.status(400).json({ error: 'Session name cannot be empty' });
      return;
    }
    const [duplicate] = await db
      .select({ id: academicSessions.id })
      .from(academicSessions)
      .where(and(
        eq(academicSessions.userId, req.userId),
        eq(academicSessions.name, String(name).trim()),
        sql`${academicSessions.id} != ${Number(req.params.id)}`,
      ))
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: 'A session with this name already exists' });
      return;
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (name !== undefined) updateData.name = String(name).trim();
  if (auto_delete !== undefined) updateData.autoDelete = auto_delete ? 1 : 0;
  if (auto_delete_date !== undefined) updateData.autoDeleteDate = auto_delete_date;

  const [updated] = await db
    .update(academicSessions)
    .set(updateData)
    .where(eq(academicSessions.id, Number(req.params.id)))
    .returning();

  res.json({ session: updated });
});

// Delete academic session (soft delete → recycle bin)
sessionRoutes.delete('/api/sessions/:id', requireNotSuspendedMiddleware, async (req, res) => {
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

  // Gather all related data for recycle bin
  const sessionSubjects = await db.select().from(subjects).where(eq(subjects.sessionId, session.id));
  const subjectIds = sessionSubjects.map((s: any) => s.id);

  let sessionWorks: typeof works.$inferSelect[] = [];
  let sessionFiles: typeof files.$inferSelect[] = [];

  if (subjectIds.length > 0) {
    sessionWorks = await db
      .select()
      .from(works)
      .where(sql`${works.subjectId} IN (${sql.join(subjectIds.map((id: any) => sql`${id}`), sql`, `)})`);

    const workIds = sessionWorks.map((w: any) => w.id);
    if (workIds.length > 0) {
      sessionFiles = await db
        .select()
        .from(files)
        .where(sql`${files.workId} IN (${sql.join(workIds.map((id: any) => sql`${id}`), sql`, `)})`);
    }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db.transaction(async (tx: any) => {
    await tx.insert(recycleBin).values({
      userId: req.userId,
      itemType: 'session',
      itemId: session.id,
      originalData: JSON.stringify({ session, subjects: sessionSubjects, works: sessionWorks, files: sessionFiles }),
      expiresAt,
    });

    await tx.delete(academicSessions).where(eq(academicSessions.id, session.id));
  });

  res.json({ success: true, message: 'Session moved to recycle bin' });
});
