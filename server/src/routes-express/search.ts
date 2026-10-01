import { Router } from 'express';
import { getDb } from '../../db/runtime.js';
import { files, works, subjects, academicSessions } from '../../db/schema.js';
import { eq, and, like, gte, lte, sql } from 'drizzle-orm';

export const searchRoutes = Router();

searchRoutes.get('/api/search', async (req, res) => {
  const db = getDb();
  const { q, sort, session_id, subject_id, extension, date_from, date_to } = req.query as any;

  // Build dynamic conditions
  const conditions: ReturnType<typeof eq>[] = [eq(files.userId, req.userId)];

  if (q && q.trim()) {
    const searchTerm = `%${q.trim()}%`;
    conditions.push(
      sql`(${files.filename} LIKE ${searchTerm} OR ${works.title} LIKE ${searchTerm} OR ${subjects.name} LIKE ${searchTerm})` as any,
    );
  }

  if (session_id) {
    conditions.push(eq(academicSessions.id, Number(session_id)));
  }

  if (subject_id) {
    conditions.push(eq(subjects.id, Number(subject_id)));
  }

  if (extension) {
    conditions.push(eq(files.extension, extension.toLowerCase().replace('.', '')));
  }

  if (date_from) {
    conditions.push(gte(files.createdAt, date_from));
  }
  if (date_to) {
    conditions.push(lte(files.createdAt, date_to));
  }

  // Sorting
  let orderByClause;
  switch (sort) {
    case 'oldest':
      orderByClause = sql`${files.createdAt} ASC`;
      break;
    case 'a-z':
      orderByClause = sql`${files.filename} ASC`;
      break;
    case 'z-a':
      orderByClause = sql`${files.filename} DESC`;
      break;
    case 'recently-updated':
      orderByClause = sql`${works.updatedAt} DESC`;
      break;
    default:
      orderByClause = sql`${files.createdAt} DESC`;
  }

  const results = await db
    .select({
      id: files.id,
      filename: files.filename,
      extension: files.extension,
      size_bytes: files.sizeBytes,
      created_at: files.createdAt,
      work_id: works.id,
      work_title: works.title,
      subject_id: subjects.id,
      subject_name: subjects.name,
      session_id: academicSessions.id,
      session_name: academicSessions.name,
    })
    .from(files)
    .innerJoin(works, eq(files.workId, works.id))
    .innerJoin(subjects, eq(works.subjectId, subjects.id))
    .innerJoin(academicSessions, eq(subjects.sessionId, academicSessions.id))
    .where(and(...conditions))
    .orderBy(orderByClause)
    .limit(100);

  // Work search conditions
  const workConditions: ReturnType<typeof eq>[] = [eq(works.userId, req.userId)];

  if (q && q.trim()) {
    const searchTerm = `%${q.trim()}%`;
    workConditions.push(
      sql`(${works.title} LIKE ${searchTerm} OR ${subjects.name} LIKE ${searchTerm})` as any,
    );
  }

  if (session_id) {
    workConditions.push(eq(academicSessions.id, Number(session_id)));
  }

  if (subject_id) {
    workConditions.push(eq(subjects.id, Number(subject_id)));
  }

  const workResults = await db
    .select({
      id: works.id,
      title: works.title,
      created_at: works.createdAt,
      updated_at: works.updatedAt,
      subject_id: subjects.id,
      subject_name: subjects.name,
      session_id: academicSessions.id,
      session_name: academicSessions.name,
      file_count: sql<number>`(SELECT COUNT(*) FROM files WHERE work_id = works.id)`,
    })
    .from(works)
    .innerJoin(subjects, eq(works.subjectId, subjects.id))
    .innerJoin(academicSessions, eq(subjects.sessionId, academicSessions.id))
    .where(and(...workConditions))
    .orderBy(sql`${works.updatedAt} DESC`)
    .limit(50);

  res.json({ 
    files: results, 
    works: workResults.map(w => ({
      ...w,
      file_count: Number(w.file_count || 0)
    }))
  });
});

searchRoutes.get('/api/search/filters', async (req, res) => {
  const db = getDb();

  const sessions = await db
    .select({ id: academicSessions.id, name: academicSessions.name })
    .from(academicSessions)
    .where(eq(academicSessions.userId, req.userId))
    .orderBy(academicSessions.name);

  const subjectsList = await db
    .select({ id: subjects.id, name: subjects.name, session_id: subjects.sessionId })
    .from(subjects)
    .where(eq(subjects.userId, req.userId))
    .orderBy(subjects.name);

  const extensions = await db
    .selectDistinct({ extension: files.extension })
    .from(files)
    .where(eq(files.userId, req.userId))
    .orderBy(files.extension);

  res.json({
    sessions,
    subjects: subjectsList,
    extensions: extensions.map((e) => e.extension),
  });
});
