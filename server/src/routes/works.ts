import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/runtime.js';
import { works, subjects, academicSessions, files, recycleBin } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireNotSuspended } from '../auth/suspension.js';

interface CreateWorkBody {
  title?: string;
}

interface UpdateWorkBody {
  title?: string;
}

export async function workRoutes(fastify: FastifyInstance): Promise<void> {
  // List works for a subject
  fastify.get<{ Params: { subjectId: string } }>(
    '/api/subjects/:subjectId/works',
    async (request, reply) => {
      const db = getDb();

      const [subject] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(
          eq(subjects.id, Number(request.params.subjectId)),
          eq(subjects.userId, request.userId),
        ))
        .limit(1);

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const result = await db
        .select({
          id: works.id,
          subjectId: works.subjectId,
          userId: works.userId,
          title: works.title,
          createdAt: works.createdAt,
          updatedAt: works.updatedAt,
          file_count: sql<number>`(SELECT COUNT(*) FROM files WHERE work_id = works.id)`,
          total_size: sql<number>`(SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE work_id = works.id)`,
        })
        .from(works)
        .where(eq(works.subjectId, Number(request.params.subjectId)))
        .orderBy(sql`${works.createdAt} DESC`);

      return { 
        works: result.map(w => ({
          ...w,
          file_count: Number(w.file_count || 0),
          total_size: Number(w.total_size || 0)
        }))
      };
    },
  );

  // Get a single work
  fastify.get<{ Params: { id: string } }>('/api/works/:id', async (request, reply) => {
    const db = getDb();
    const [work] = await db
      .select({
        id: works.id,
        subjectId: works.subjectId,
        userId: works.userId,
        title: works.title,
        createdAt: works.createdAt,
        updatedAt: works.updatedAt,
        subject_name: subjects.name,
        subject_id: subjects.id,
        session_name: academicSessions.name,
        session_id: academicSessions.id,
        file_count: sql<number>`(SELECT COUNT(*) FROM files WHERE work_id = works.id)`,
        total_size: sql<number>`(SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE work_id = works.id)`,
      })
      .from(works)
      .innerJoin(subjects, eq(works.subjectId, subjects.id))
      .innerJoin(academicSessions, eq(subjects.sessionId, academicSessions.id))
      .where(and(
        eq(works.id, Number(request.params.id)),
        eq(works.userId, request.userId),
      ))
      .limit(1);

    if (!work) {
      return reply.status(404).send({ error: 'Work not found' });
    }

    return { 
      work: {
        ...work,
        file_count: Number(work.file_count || 0),
        total_size: Number(work.total_size || 0)
      }
    };
  });

  // Create work
  fastify.post<{ Params: { subjectId: string }; Body: CreateWorkBody }>(
    '/api/subjects/:subjectId/works',
    async (request, reply) => {
      if (await requireNotSuspended(request, reply)) return;

      const db = getDb();
      const title = request.body?.title?.trim() || new Date().toISOString().split('T')[0];

      // Verify subject ownership
      const [subject] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(
          eq(subjects.id, Number(request.params.subjectId)),
          eq(subjects.userId, request.userId),
        ))
        .limit(1);

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const [work] = await db
        .insert(works)
        .values({
          subjectId: Number(request.params.subjectId),
          userId: request.userId,
          title,
        })
        .returning();

      return reply.status(201).send({ work });
    },
  );

  // Update work
  fastify.patch<{ Params: { id: string }; Body: UpdateWorkBody }>(
    '/api/works/:id',
    async (request, reply) => {
      const db = getDb();
      const [work] = await db
        .select()
        .from(works)
        .where(and(
          eq(works.id, Number(request.params.id)),
          eq(works.userId, request.userId),
        ))
        .limit(1);

      if (!work) {
        return reply.status(404).send({ error: 'Work not found' });
      }

      const { title } = request.body;
      if (title !== undefined && !title.trim()) {
        return reply.status(400).send({ error: 'Work title cannot be empty' });
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (title !== undefined) updateData.title = title.trim();

      const [updated] = await db
        .update(works)
        .set(updateData)
        .where(and(eq(works.id, Number(request.params.id)), eq(works.userId, request.userId)))
        .returning();

      return { work: updated };
    },
  );

  // Delete work (soft delete)
  fastify.delete<{ Params: { id: string } }>('/api/works/:id', async (request, reply) => {
    if (await requireNotSuspended(request, reply)) return;

    const db = getDb();
    const [work] = await db
      .select()
      .from(works)
      .where(and(
        eq(works.id, Number(request.params.id)),
        eq(works.userId, request.userId),
      ))
      .limit(1);

    if (!work) {
      return reply.status(404).send({ error: 'Work not found' });
    }

    const workFiles = await db.select().from(files).where(eq(files.workId, work.id));
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.transaction(async (tx) => {
      await tx.insert(recycleBin).values({
        userId: request.userId,
        itemType: 'work',
        itemId: work.id,
        originalData: JSON.stringify({ work, files: workFiles }),
        expiresAt,
      });

      await tx.delete(works).where(eq(works.id, work.id));
    });

    return { success: true, message: 'Work moved to recycle bin' };
  });
}
