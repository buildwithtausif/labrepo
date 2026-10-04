import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { messages, userKeys, friendships, sharedFiles, files } from '../db/schema.js';
import { eq, and, or, sql } from 'drizzle-orm';
import { EventEmitter } from 'events';
import { getIo } from '../socket.js';

import type { StorageResolverFn } from './files.js';

// Simple event emitter for SSE
export const chatEmitter = new EventEmitter();

export function createMessageRoutes(resolveStorage: StorageResolverFn) {
  const messageRoutes = Router();

// Helper to verify friendship
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

// POST /api/keys (Upload public key)
messageRoutes.post('/api/keys', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const { publicKey } = req.body;

  if (!publicKey) return res.status(400).json({ error: 'publicKey required' });

  try {
    const [existing] = await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1);
    if (existing) {
      await db.update(userKeys).set({ publicKey, updatedAt: new Date().toISOString() }).where(eq(userKeys.userId, userId));
    } else {
      await db.insert(userKeys).values({ userId, publicKey });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save key', details: err.message });
  }
});

// GET /api/keys/:userId (Get friend's public key)
messageRoutes.get('/api/keys/:userId', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendId = req.params.userId;

  try {
    if (!(await verifyFriendship(userId, friendId))) {
      return res.status(403).json({ error: 'Not friends' });
    }

    const [keyRecord] = await db.select().from(userKeys).where(eq(userKeys.userId, friendId)).limit(1);
    if (!keyRecord) {
      return res.status(404).json({ error: 'Public key not found for this user' });
    }

    res.json({ publicKey: keyRecord.publicKey });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get key', details: err.message });
  }
});

// GET /api/messages/:friendId (Fetch history)
messageRoutes.get('/api/messages/:friendId', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendId = req.params.friendId;

  try {
    if (!(await verifyFriendship(userId, friendId))) {
      return res.status(403).json({ error: 'Not friends' });
    }

    const history = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        receiverId: messages.receiverId,
        encryptedContent: messages.encryptedContent,
        iv: messages.iv,
        sharedFileId: messages.sharedFileId,
        isRead: messages.isRead,
        maxViews: messages.maxViews,
        viewCount: messages.viewCount,
        createdAt: messages.createdAt,
        filename: sql<string | null>`${files.filename}`.as('filename'),
      })
      .from(messages)
      .leftJoin(sharedFiles, eq(messages.sharedFileId, sharedFiles.id))
      .leftJoin(files, eq(sharedFiles.fileId, files.id))
      .where(
        or(
          and(eq(messages.senderId, userId), eq(messages.receiverId, friendId), eq(messages.visibleToSender, 1)),
          and(eq(messages.senderId, friendId), eq(messages.receiverId, userId), eq(messages.visibleToReceiver, 1))
        )
      )
      .orderBy(sql`${messages.createdAt} ASC`)
      .limit(100);

    // Filter out exhausted view-twice messages
    const validHistory = history.filter(m => {
      if (m.maxViews > 0 && m.viewCount >= m.maxViews) return false;
      return true;
    });

    // Mark as read
    const unreadIds = validHistory.filter(m => m.receiverId === userId && !m.isRead).map(m => m.id);
    if (unreadIds.length > 0) {
      await db.execute(sql`UPDATE messages SET is_read = 1 WHERE id IN ${unreadIds} AND receiver_id = ${userId}`);
      chatEmitter.emit(`messages_read:${friendId}`, { readerId: userId });
      try {
        getIo().to(friendId).emit('messages_read', { readerId: userId });
      } catch (e) {}
    }

    res.json({ messages: validHistory });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch messages', details: err.message });
  }
});

// POST /api/messages/:friendId (Send message)
messageRoutes.post('/api/messages/:friendId', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendId = req.params.friendId;
  const { encryptedContent, iv, sharedFileId, maxViews } = req.body;

  if (!encryptedContent || !iv) {
    return res.status(400).json({ error: 'encryptedContent and iv are required' });
  }

  try {
    if (!(await verifyFriendship(userId, friendId))) {
      return res.status(403).json({ error: 'Not friends' });
    }

    const [msg] = await db.insert(messages).values({
      senderId: userId,
      receiverId: friendId,
      encryptedContent,
      iv,
      sharedFileId: sharedFileId || null,
      maxViews: maxViews || 0,
    }).returning();

    let filename: string | null = null;
    if (sharedFileId) {
      const [fileRecord] = await db
        .select({ filename: files.filename })
        .from(sharedFiles)
        .innerJoin(files, eq(sharedFiles.fileId, files.id))
        .where(eq(sharedFiles.id, sharedFileId))
        .limit(1);
      if (fileRecord) {
        filename = fileRecord.filename;
      }
    }
    const msgWithFile = { ...msg, filename };

    // Emit event for real-time delivery via SSE and Socket.IO
    chatEmitter.emit(`message:${friendId}`, msgWithFile);
    
    try {
      getIo().to(friendId).emit('new_message', msgWithFile);
    } catch(e) {
      console.warn('Socket not initialized or emit failed', e);
    }

    res.status(201).json({ success: true, message: msgWithFile });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

// PUT /api/messages/:friendId/read (Mark all read)
messageRoutes.put('/api/messages/:friendId/read', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendId = req.params.friendId;
  try {
    await db.execute(sql`UPDATE messages SET is_read = 1 WHERE sender_id = ${friendId} AND receiver_id = ${userId} AND is_read = 0`);
    chatEmitter.emit(`messages_read:${friendId}`, { readerId: userId });
    try { getIo().to(friendId).emit('messages_read', { readerId: userId }); } catch(e) {}
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to mark read', details: err.message });
  }
});

// POST /api/messages/:friendId/clear (Clear chat for me)
messageRoutes.post('/api/messages/:friendId/clear', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendId = req.params.friendId;
  try {
    await db.execute(sql`UPDATE messages SET visible_to_sender = 0 WHERE sender_id = ${userId} AND receiver_id = ${friendId}`);
    await db.execute(sql`UPDATE messages SET visible_to_receiver = 0 WHERE sender_id = ${friendId} AND receiver_id = ${userId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to clear chat', details: err.message });
  }
});

// PUT /api/messages/:messageId/view (Increment view count)
messageRoutes.put('/api/messages/:messageId/view', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const messageId = parseInt(req.params.messageId, 10);
  try {
    const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!msg || msg.receiverId !== userId) {
      return res.status(403).json({ error: 'Not authorized or message not found' });
    }

    if (msg.maxViews > 0) {
      const newViewCount = msg.viewCount + 1;
      await db.update(messages).set({ viewCount: newViewCount }).where(eq(messages.id, messageId));
      return res.json({ success: true, viewCount: newViewCount });
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to record view', details: err.message });
  }
});

// DELETE /api/messages/:messageId (Delete for everyone)
messageRoutes.delete('/api/messages/:messageId', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const messageId = parseInt(req.params.messageId, 10);
  try {
    const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!msg || msg.senderId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }
    await db.delete(messages).where(eq(messages.id, messageId));
    
    chatEmitter.emit(`message_deleted:${msg.receiverId}`, { messageId });
    try { getIo().to(msg.receiverId).emit('message_deleted', { messageId }); } catch(e) {}
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete message', details: err.message });
  }
});

// DELETE /api/messages/:friendId/all (Delete entire chat for everyone)
messageRoutes.delete('/api/messages/:friendId/all', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendId = req.params.friendId;
  try {
    if (!(await verifyFriendship(userId, friendId))) {
      return res.status(403).json({ error: 'Not friends' });
    }
    
    await db.delete(messages).where(
      or(
        and(eq(messages.senderId, userId), eq(messages.receiverId, friendId)),
        and(eq(messages.senderId, friendId), eq(messages.receiverId, userId))
      )
    );
    
    chatEmitter.emit(`chat_deleted_for_everyone:${friendId}`, { by: userId });
    try { getIo().to(friendId).emit('chat_deleted_for_everyone', { by: userId }); } catch(e) {}
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete chat', details: err.message });
  }
});

// GET /api/messages/events (SSE endpoint)
messageRoutes.get('/api/messages-events', (req, res) => {
  const userId = req.userId!;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onMessage = (msg: any) => {
    res.write(`data: ${JSON.stringify({ type: 'new_message', ...msg })}\n\n`);
  };
  const onDeleted = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'message_deleted', ...data })}\n\n`);
  };
  const onRead = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'messages_read', ...data })}\n\n`);
  };
  const onChatDeleted = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'chat_deleted_for_everyone', ...data })}\n\n`);
  };

  chatEmitter.on(`message:${userId}`, onMessage);
  chatEmitter.on(`message_deleted:${userId}`, onDeleted);
  chatEmitter.on(`messages_read:${userId}`, onRead);
  chatEmitter.on(`chat_deleted_for_everyone:${userId}`, onChatDeleted);

  req.on('close', () => {
    chatEmitter.off(`message:${userId}`, onMessage);
    chatEmitter.off(`message_deleted:${userId}`, onDeleted);
    chatEmitter.off(`messages_read:${userId}`, onRead);
    chatEmitter.off(`chat_deleted_for_everyone:${userId}`, onChatDeleted);
  });
});

// DELETE /api/messages/:messageId/exhaust (Exhaust a view-twice message)
messageRoutes.delete('/api/messages/:messageId/exhaust', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const messageId = parseInt(req.params.messageId, 10);
  try {
    const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!msg || msg.receiverId !== userId) {
      return res.status(403).json({ error: 'Not authorized or message not found' });
    }

    if (msg.maxViews > 0 && msg.viewCount >= msg.maxViews) {
      // It is exhausted! Let's delete the file if there is one.
      if (msg.sharedFileId) {
        const [sharedFile] = await db.select().from(sharedFiles).where(eq(sharedFiles.id, msg.sharedFileId)).limit(1);
        if (sharedFile) {
           const [fileRecord] = await db.select().from(files).where(eq(files.id, sharedFile.fileId)).limit(1);
           if (fileRecord) {
              const storage = await resolveStorage(fileRecord.userId);
              try {
                await storage.delete(fileRecord.storageKey || (fileRecord as any).storage_key);
              } catch (e) {
                console.error('Failed to delete exhausted file from storage', e);
              }
              // Delete from db
              await db.delete(files).where(eq(files.id, fileRecord.id));
              await db.delete(sharedFiles).where(eq(sharedFiles.id, sharedFile.id));
           }
        }
      }
      
      // We can also delete the message itself, or just leave it as exhausted. 
      // The user asked "these should be deleted as soon as they close the lightbox".
      // We'll delete the message too.
      await db.delete(messages).where(eq(messages.id, messageId));
      chatEmitter.emit(`message_deleted:${msg.receiverId}`, { messageId });
      chatEmitter.emit(`message_deleted:${msg.senderId}`, { messageId });
      try { getIo().to(msg.receiverId).emit('message_deleted', { messageId }); } catch(e) {}
      try { getIo().to(msg.senderId).emit('message_deleted', { messageId }); } catch(e) {}
      
      return res.json({ success: true, deleted: true });
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to exhaust message', details: err.message });
  }
});

  return messageRoutes;
}
