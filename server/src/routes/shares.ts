import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { files, sharedFiles, friendships, works, subjects, academicSessions, users } from '../db/schema.js';
import { eq, and, or, sql } from 'drizzle-orm';
import type { StorageResolverFn } from './files.js';
import { upload } from '../middlewares/upload.js';
import { buildStorageKey } from '../storage/adapter.js';
import { getDynamicSecurityConfig } from '../services/config.service.js';
import { validateUploadCandidate } from '../services/validation.service.js';

export function createShareRoutes(resolveStorage: StorageResolverFn) {
  const router = Router();

  // Helper middleware to verify friendship
  const verifyFriendship = async (userId: string, friendId: string) => {
    const db = getDb();
    const [friendship] = await db
      .select()
      .from(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, userId), eq(friendships.receiverId, friendId), eq(friendships.status, 'accepted')),
          and(eq(friendships.requesterId, friendId), eq(friendships.receiverId, userId), eq(friendships.status, 'accepted'))
        )
      )
      .limit(1);
    return !!friendship;
  };

  // GET /api/shares
  // List files shared WITH the user
  router.get('/api/shares', async (req, res) => {
    const db = getDb();
    const userId = req.userId!;
    
    try {
      const incoming = await db
        .select({
          sharedFileId: sharedFiles.id,
          senderId: sharedFiles.senderId,
          createdAt: sharedFiles.createdAt,
          fileId: files.id,
          filename: files.filename,
          extension: files.extension,
          sizeBytes: files.sizeBytes,
        })
        .from(sharedFiles)
        .innerJoin(files, eq(sharedFiles.fileId, files.id))
        .where(eq(sharedFiles.receiverId, userId))
        .orderBy(sql`${sharedFiles.createdAt} DESC`);

      const outgoing = await db
        .select({
          sharedFileId: sharedFiles.id,
          receiverId: sharedFiles.receiverId,
          createdAt: sharedFiles.createdAt,
          fileId: files.id,
          filename: files.filename,
          extension: files.extension,
          sizeBytes: files.sizeBytes,
        })
        .from(sharedFiles)
        .innerJoin(files, eq(sharedFiles.fileId, files.id))
        .where(eq(sharedFiles.senderId, userId))
        .orderBy(sql`${sharedFiles.createdAt} DESC`);

      res.json({ incoming, outgoing });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch shared files', details: err.message });
    }
  });

  // POST /api/shares/existing
  // Share an existing Labrepo file
  router.post('/api/shares/existing', async (req, res) => {
    const db = getDb();
    const userId = req.userId!;
    const { fileId, friendId } = req.body;

    if (!fileId || !friendId) {
      return res.status(400).json({ error: 'fileId and friendId are required' });
    }

    try {
      if (!(await verifyFriendship(userId, friendId))) {
        return res.status(403).json({ error: 'You are not friends with this user' });
      }

      // Verify ownership of the file
      const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
      if (!file) {
        return res.status(404).json({ error: 'File not found or not owned by you' });
      }

      // Check if already shared
      const [existing] = await db
        .select()
        .from(sharedFiles)
        .where(and(eq(sharedFiles.fileId, fileId), eq(sharedFiles.receiverId, friendId)))
        .limit(1);

      if (existing) {
        return res.status(400).json({ error: 'File is already shared with this user' });
      }

      const [newShare] = await db.insert(sharedFiles).values({
        fileId: fileId,
        senderId: userId,
        receiverId: friendId,
      }).returning();

      res.status(201).json({ success: true, share: newShare });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to share file', details: err.message });
    }
  });

  // GET /api/shares/download/:sharedFileId
  // Download a shared file
  router.get('/api/shares/download/:id', async (req, res) => {
    const db = getDb();
    const userId = req.userId!;
    const sharedFileId = parseInt(req.params.id, 10);

    if (isNaN(sharedFileId)) {
      return res.status(400).json({ error: 'Invalid sharedFileId' });
    }

    try {
      const [shareRecord] = await db
        .select({
          file: files,
          receiverId: sharedFiles.receiverId,
          senderId: sharedFiles.senderId,
        })
        .from(sharedFiles)
        .innerJoin(files, eq(sharedFiles.fileId, files.id))
        .where(eq(sharedFiles.id, sharedFileId))
        .limit(1);

      if (!shareRecord) {
        return res.status(404).json({ error: 'Shared file not found' });
      }

      if (shareRecord.receiverId !== userId && shareRecord.senderId !== userId) {
        return res.status(403).json({ error: 'Not authorized to download this file' });
      }

      // Resolve the original owner's storage adapter
      const ownerId = shareRecord.file.userId;
      const storage = await resolveStorage(ownerId);
      
      const { data, contentType } = await storage.download(shareRecord.file.storageKey);

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${shareRecord.file.filename}"`,
        'Content-Length': data.length
      });
      res.send(data);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to download shared file', details: err.message });
    }
  });

  // POST /api/shares/upload
  // Direct upload flow
  router.post('/api/shares/upload', upload.single('file'), async (req, res) => {
    const db = getDb();
    const uploaderId = req.userId!;
    const { friendId, destinationSubjectId } = req.body; // if no destinationSubjectId, use "Shared Folder" (provisioned automatically)

    if (!friendId || !req.file) {
      return res.status(400).json({ error: 'friendId and file are required' });
    }

    try {
      if (!(await verifyFriendship(uploaderId, friendId))) {
        return res.status(403).json({ error: 'You are not friends with this user' });
      }

      // Check recipient's upload approval setting
      const [recipientUser] = await db.select({ requireUploadApproval: users.requireUploadApproval }).from(users).where(eq(users.clerkId, friendId)).limit(1);
      if (recipientUser?.requireUploadApproval === 1) {
        return res.status(403).json({ error: 'Recipient has disabled direct uploads or requires approval.' });
      }

      const fileData = req.file.buffer;
      const originalname = req.file.originalname;

      // Ensure recipient quota/limits
      const dynamicConfig = await getDynamicSecurityConfig(db, friendId); // NOTE: using recipient's config
      const validation = validateUploadCandidate({
        filename: originalname,
        size: fileData.length,
        contentType: req.file.mimetype,
        allowedExtensions: new Set(dynamicConfig.allowedExtensions),
        maxBytes: dynamicConfig.maxUploadBytes,
      });

      if (!validation.valid) {
        return res.status(400).json({ error: `Recipient validation failed: ${validation.reason}` });
      }

      let targetWorkId: number;
      let sessionName: string;
      let subjectName: string;
      let workTitle = 'Direct Upload';

      if (destinationSubjectId) {
        // Upload to specific subject
        const [subject] = await db
          .select({ id: subjects.id, name: subjects.name, sessionId: subjects.sessionId })
          .from(subjects)
          .where(and(eq(subjects.id, parseInt(destinationSubjectId, 10)), eq(subjects.userId, friendId)))
          .limit(1);
        
        if (!subject) return res.status(404).json({ error: 'Destination subject not found in recipient account' });

        const [session] = await db.select().from(academicSessions).where(eq(academicSessions.id, subject.sessionId)).limit(1);
        sessionName = session.name;
        subjectName = subject.name;

        // Auto-create a generic work or find one
        let [work] = await db.select().from(works).where(and(eq(works.subjectId, subject.id), eq(works.title, 'Direct Uploads'))).limit(1);
        if (!work) {
          [work] = await db.insert(works).values({ subjectId: subject.id, userId: friendId, title: 'Direct Uploads' }).returning();
        }
        targetWorkId = work.id;
      } else {
        // "Shared Folder" approach -> _Circles session
        sessionName = '_Circles';
        let [session] = await db.select().from(academicSessions).where(and(eq(academicSessions.name, sessionName), eq(academicSessions.userId, friendId))).limit(1);
        if (!session) {
          [session] = await db.insert(academicSessions).values({ userId: friendId, name: sessionName }).returning();
        }

        subjectName = `Shared with Uploader`; // generic name, or ideally 'Shared by [uploaderName]' but we don't have it here easily
        let [subject] = await db.select().from(subjects).where(and(eq(subjects.sessionId, session.id), eq(subjects.name, subjectName))).limit(1);
        if (!subject) {
          [subject] = await db.insert(subjects).values({ sessionId: session.id, userId: friendId, name: subjectName }).returning();
        }

        let [work] = await db.select().from(works).where(and(eq(works.subjectId, subject.id), eq(works.title, 'Incoming'))).limit(1);
        if (!work) {
          [work] = await db.insert(works).values({ subjectId: subject.id, userId: friendId, title: 'Incoming' }).returning();
        }
        targetWorkId = work.id;
      }

      const ext = validation.extension || 'bin';
      const sanitized = validation.sanitizedFilename || originalname;
      const storageKey = buildStorageKey(friendId, sessionName, subjectName, workTitle, sanitized);
      const mime = validation.contentType || 'application/octet-stream';

      // Resolve recipient's storage
      const recipientStorage = await resolveStorage(friendId);
      await recipientStorage.upload(storageKey, fileData, mime);

      const [newFile] = await db.insert(files).values({
        workId: targetWorkId,
        userId: friendId, // owned by recipient now
        filename: originalname,
        sanitizedFilename: sanitized,
        extension: ext,
        sizeBytes: fileData.length,
        storageKey,
        contentType: mime,
      }).returning();

      // Optionally, automatically create a shared_files record so the sender still has access?
      // Yes, this makes sense so they can see what they sent.
      await db.insert(sharedFiles).values({
        fileId: newFile.id,
        senderId: uploaderId,
        receiverId: friendId,
      });

      res.status(201).json({ success: true, file: newFile });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to upload directly', details: err.message });
    }
  });

  return router;
}
