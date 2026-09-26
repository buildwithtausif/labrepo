import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/runtime.js';
import { academicSessions, subjects, works, files, recycleBin } from '../db/schema.js';
import { eq, and, sql, count } from 'drizzle-orm';
import { requireNotSuspended } from '../auth/suspension.js';

interface CreateSessionBody {
  name: string;
  auto_delete?: boolean;
  auto_delete_date?: string;
}

interface UpdateSessionBody {
  name?: string;
  auto_delete?: boolean;
  auto_delete_date?: string;
}

export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  // List all academic sessions for the user
  fastify.get('/api/sessions', async (request) => {
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
      .where(eq(academicSessions.userId, request.userId))
      .orderBy(sql`${academicSessions.createdAt} DESC`);

    return { 
      sessions: sessions.map(s => ({
        ...s,
        subject_count: Number(s.subject_count || 0),
        file_count: Number(s.file_count || 0)
      }))
    };
  });

  // Get a single session
  fastify.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
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
        eq(academicSessions.id, Number(request.params.id)),
        eq(academicSessions.userId, request.userId),
      ))
      .limit(1);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return { 
      session: {
        ...session,
        subject_count: Number(session.subject_count || 0),
        file_count: Number(session.file_count || 0)
      }
    };
  });

  // Create academic session
  fastify.post<{ Body: CreateSessionBody }>('/api/sessions', async (request, reply) => {
    if (await requireNotSuspended(request, reply)) return;

    const { name, auto_delete, auto_delete_date } = request.body;

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Session name is required' });
    }

    const db = getDb();

    // Check for duplicate name
    const [existing] = await db
      .select({ id: academicSessions.id })
      .from(academicSessions)
      .where(and(
        eq(academicSessions.userId, request.userId),
        eq(academicSessions.name, name.trim()),
      ))
      .limit(1);

    if (existing) {
      return reply.status(409).send({ error: 'A session with this name already exists' });
    }

    // Default auto_delete_date: July 31 of the end year if session looks like "YYYY-YYYY"
    let deleteDate = auto_delete_date || null;
    if (auto_delete && !deleteDate) {
      const yearMatch = name.match(/(\d{4})\s*[-–]\s*(\d{4})/);
      if (yearMatch) {
        deleteDate = `${yearMatch[2]}-07-31`;
      }
    }

    const [session] = await db
      .insert(academicSessions)
      .values({
        userId: request.userId,
        name: name.trim(),
        autoDelete: auto_delete ? 1 : 0,
        autoDeleteDate: deleteDate,
      })
      .returning();

    return reply.status(201).send({ session });
  });

  // Update academic session
  fastify.patch<{ Params: { id: string }; Body: UpdateSessionBody }>(
    '/api/sessions/:id',
    async (request, reply) => {
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

      const { name, auto_delete, auto_delete_date } = request.body;

      if (name !== undefined) {
        if (!name.trim()) {
          return reply.status(400).send({ error: 'Session name cannot be empty' });
        }
        const [duplicate] = await db
          .select({ id: academicSessions.id })
          .from(academicSessions)
          .where(and(
            eq(academicSessions.userId, request.userId),
            eq(academicSessions.name, name.trim()),
            sql`${academicSessions.id} != ${Number(request.params.id)}`,
          ))
          .limit(1);
        if (duplicate) {
          return reply.status(409).send({ error: 'A session with this name already exists' });
        }
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (name !== undefined) updateData.name = name.trim();
      if (auto_delete !== undefined) updateData.autoDelete = auto_delete ? 1 : 0;
      if (auto_delete_date !== undefined) updateData.autoDeleteDate = auto_delete_date;

      const [updated] = await db
        .update(academicSessions)
        .set(updateData)
        .where(eq(academicSessions.id, Number(request.params.id)))
        .returning();

      return { session: updated };
    },
  );

  // Delete academic session (soft delete → recycle bin)
  fastify.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    if (await requireNotSuspended(request, reply)) return;

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

    // Gather all related data for recycle bin
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
        userId: request.userId,
        itemType: 'session',
        itemId: session.id,
        originalData: JSON.stringify({ session, subjects: sessionSubjects, works: sessionWorks, files: sessionFiles }),
        expiresAt,
      });

      await tx.delete(academicSessions).where(eq(academicSessions.id, session.id));
    });

    return { success: true, message: 'Session moved to recycle bin' };
  });
}
