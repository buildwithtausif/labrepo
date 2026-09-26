import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/runtime.js';
import { subjects, academicSessions, works, files, recycleBin } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireNotSuspended } from '../auth/suspension.js';

interface CreateSubjectBody {
  name: string;
}

interface UpdateSubjectBody {
  name?: string;
}

export async function subjectRoutes(fastify: FastifyInstance): Promise<void> {
  // List subjects for a session
  fastify.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/subjects',
    async (request, reply) => {
      const db = getDb();

      // Verify session ownership
      const [session] = await db
        .select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, Number(request.params.sessionId)),
          eq(academicSessions.userId, request.userId),
        ))
        .limit(1);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
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
        .where(eq(subjects.sessionId, Number(request.params.sessionId)))
        .orderBy(subjects.name);

      return { 
        subjects: result.map(s => ({
          ...s,
          work_count: Number(s.work_count || 0),
          file_count: Number(s.file_count || 0),
          total_size: Number(s.total_size || 0)
        }))
      };
    },
  );

  // Get a single subject
  fastify.get<{ Params: { id: string } }>('/api/subjects/:id', async (request, reply) => {
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
        eq(subjects.id, Number(request.params.id)),
        eq(subjects.userId, request.userId),
      ))
      .limit(1);

    if (!subject) {
      return reply.status(404).send({ error: 'Subject not found' });
    }

    return { 
      subject: {
        ...subject,
        work_count: Number(subject.work_count || 0),
        file_count: Number(subject.file_count || 0),
        total_size: Number(subject.total_size || 0)
      }
    };
  });

  // Create subject
  fastify.post<{ Params: { sessionId: string }; Body: CreateSubjectBody }>(
    '/api/sessions/:sessionId/subjects',
    async (request, reply) => {
      if (await requireNotSuspended(request, reply)) return;

      const { name } = request.body;

      if (!name || !name.trim()) {
        return reply.status(400).send({ error: 'Subject name is required' });
      }

      const db = getDb();

      const [session] = await db
        .select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, Number(request.params.sessionId)),
          eq(academicSessions.userId, request.userId),
        ))
        .limit(1);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const [existing] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(
          eq(subjects.sessionId, Number(request.params.sessionId)),
          eq(subjects.name, name.trim()),
        ))
        .limit(1);

      if (existing) {
        return reply.status(409).send({ error: 'A subject with this name already exists in this session' });
      }

      const [subject] = await db
        .insert(subjects)
        .values({
          sessionId: Number(request.params.sessionId),
          userId: request.userId,
          name: name.trim(),
        })
        .returning();

      return reply.status(201).send({ subject });
    },
  );

  // Batch create subjects (for onboarding)
  fastify.post<{ Params: { sessionId: string }; Body: { names: string[] } }>(
    '/api/sessions/:sessionId/subjects/batch',
    async (request, reply) => {
      if (await requireNotSuspended(request, reply)) return;

      const { names } = request.body;

      if (!names || !Array.isArray(names) || names.length === 0) {
        return reply.status(400).send({ error: 'At least one subject name is required' });
      }

      const db = getDb();

      const [session] = await db
        .select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, Number(request.params.sessionId)),
          eq(academicSessions.userId, request.userId),
        ))
        .limit(1);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const created: typeof subjects.$inferSelect[] = [];
      const skipped: string[] = [];

      await db.transaction(async (tx) => {
        for (const name of names) {
          const trimmed = name.trim();
          if (!trimmed) continue;

          const inserted = await tx
            .insert(subjects)
            .values({
              sessionId: Number(request.params.sessionId),
              userId: request.userId,
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

      return reply.status(201).send({ created, skipped });
    },
  );

  // Update subject
  fastify.patch<{ Params: { id: string }; Body: UpdateSubjectBody }>(
    '/api/subjects/:id',
    async (request, reply) => {
      const db = getDb();
      const [subject] = await db
        .select()
        .from(subjects)
        .where(and(
          eq(subjects.id, Number(request.params.id)),
          eq(subjects.userId, request.userId),
        ))
        .limit(1);

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const { name } = request.body;
      if (name !== undefined) {
        if (!name.trim()) {
          return reply.status(400).send({ error: 'Subject name cannot be empty' });
        }
        const [duplicate] = await db
          .select({ id: subjects.id })
          .from(subjects)
          .where(and(
            eq(subjects.sessionId, subject.sessionId),
            eq(subjects.name, name.trim()),
            sql`${subjects.id} != ${Number(request.params.id)}`,
          ))
          .limit(1);
        if (duplicate) {
          return reply.status(409).send({ error: 'A subject with this name already exists' });
        }
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (name !== undefined) updateData.name = name.trim();

      const [updated] = await db
        .update(subjects)
        .set(updateData)
        .where(eq(subjects.id, Number(request.params.id)))
        .returning();

      return { subject: updated };
    },
  );

  // Delete subject (soft delete)
  fastify.delete<{ Params: { id: string } }>('/api/subjects/:id', async (request, reply) => {
    if (await requireNotSuspended(request, reply)) return;

    const db = getDb();
    const [subject] = await db
      .select()
      .from(subjects)
      .where(and(
        eq(subjects.id, Number(request.params.id)),
        eq(subjects.userId, request.userId),
      ))
      .limit(1);

    if (!subject) {
      return reply.status(404).send({ error: 'Subject not found' });
    }

    const subjectWorks = await db.select().from(works).where(eq(works.subjectId, subject.id));
    const workIds = subjectWorks.map((w) => w.id);
    let subjectFiles: typeof files.$inferSelect[] = [];
    if (workIds.length > 0) {
      subjectFiles = await db
        .select()
        .from(files)
        .where(sql`${files.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`);
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.transaction(async (tx) => {
      await tx.insert(recycleBin).values({
        userId: request.userId,
        itemType: 'subject',
        itemId: subject.id,
        originalData: JSON.stringify({ subject, works: subjectWorks, files: subjectFiles }),
        expiresAt,
      });

      await tx.delete(subjects).where(eq(subjects.id, subject.id));
    });

    return { success: true, message: 'Subject moved to recycle bin' };
  });
}
