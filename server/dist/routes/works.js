import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { works, subjects, academicSessions, files, recycleBin } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireNotSuspendedMiddleware } from '../auth/suspension.js';
export const workRoutes = Router();
// List works for a subject
workRoutes.get('/api/subjects/:subjectId/works', async (req, res) => {
    const db = getDb();
    const [subject] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.id, Number(req.params.subjectId)), eq(subjects.userId, req.userId)))
        .limit(1);
    if (!subject) {
        res.status(404).json({ error: 'Subject not found' });
        return;
    }
    const result = await db
        .select({
        id: works.id,
        subjectId: works.subjectId,
        userId: works.userId,
        title: works.title,
        createdAt: works.createdAt,
        updatedAt: works.updatedAt,
        file_count: sql `(SELECT COUNT(*) FROM files WHERE work_id = works.id)`,
        total_size: sql `(SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE work_id = works.id)`,
    })
        .from(works)
        .where(eq(works.subjectId, Number(req.params.subjectId)))
        .orderBy(sql `${works.createdAt} DESC`);
    res.json({
        works: result.map((w) => ({
            ...w,
            file_count: Number(w.file_count || 0),
            total_size: Number(w.total_size || 0)
        }))
    });
});
// Get a single work
workRoutes.get('/api/works/:id', async (req, res) => {
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
        file_count: sql `(SELECT COUNT(*) FROM files WHERE work_id = works.id)`,
        total_size: sql `(SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE work_id = works.id)`,
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
    res.json({
        work: {
            ...work,
            file_count: Number(work.file_count || 0),
            total_size: Number(work.total_size || 0)
        }
    });
});
// Create work
workRoutes.post('/api/subjects/:subjectId/works', requireNotSuspendedMiddleware, async (req, res) => {
    const db = getDb();
    const title = String(req.body?.title || '').trim() || new Date().toISOString().split('T')[0];
    // Verify subject ownership
    const [subject] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.id, Number(req.params.subjectId)), eq(subjects.userId, req.userId)))
        .limit(1);
    if (!subject) {
        res.status(404).json({ error: 'Subject not found' });
        return;
    }
    const [work] = await db
        .insert(works)
        .values({
        subjectId: Number(req.params.subjectId),
        userId: req.userId,
        title,
    })
        .returning();
    res.status(201).json({ work });
});
// Update work
workRoutes.patch('/api/works/:id', async (req, res) => {
    const db = getDb();
    const [work] = await db
        .select()
        .from(works)
        .where(and(eq(works.id, Number(req.params.id)), eq(works.userId, req.userId)))
        .limit(1);
    if (!work) {
        res.status(404).json({ error: 'Work not found' });
        return;
    }
    const { title } = req.body;
    if (title !== undefined && !String(title).trim()) {
        res.status(400).json({ error: 'Work title cannot be empty' });
        return;
    }
    const updateData = { updatedAt: new Date().toISOString() };
    if (title !== undefined)
        updateData.title = String(title).trim();
    const [updated] = await db
        .update(works)
        .set(updateData)
        .where(and(eq(works.id, Number(req.params.id)), eq(works.userId, req.userId)))
        .returning();
    res.json({ work: updated });
});
// Delete work (soft delete)
workRoutes.delete('/api/works/:id', requireNotSuspendedMiddleware, async (req, res) => {
    const db = getDb();
    const [work] = await db
        .select()
        .from(works)
        .where(and(eq(works.id, Number(req.params.id)), eq(works.userId, req.userId)))
        .limit(1);
    if (!work) {
        res.status(404).json({ error: 'Work not found' });
        return;
    }
    const workFiles = await db.select().from(files).where(eq(files.workId, work.id));
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.transaction(async (tx) => {
        await tx.insert(recycleBin).values({
            userId: req.userId,
            itemType: 'work',
            itemId: work.id,
            originalData: JSON.stringify({ work, files: workFiles }),
            expiresAt,
        });
        await tx.delete(works).where(eq(works.id, work.id));
    });
    res.json({ success: true, message: 'Work moved to recycle bin' });
});
