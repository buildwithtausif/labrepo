import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { messages, userKeys, friendships } from '../db/schema.js';
import { eq, and, or, sql } from 'drizzle-orm';
import { EventEmitter } from 'events';

// Simple event emitter for SSE
export const chatEmitter = new EventEmitter();

export const messageRoutes = Router();

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
      .select()
      .from(messages)
      .where(
        or(
          and(eq(messages.senderId, userId), eq(messages.receiverId, friendId)),
          and(eq(messages.senderId, friendId), eq(messages.receiverId, userId))
        )
      )
      .orderBy(sql`${messages.createdAt} ASC`)
      .limit(100);

    // Mark as read
    const unreadIds = history.filter(m => m.receiverId === userId && !m.isRead).map(m => m.id);
    if (unreadIds.length > 0) {
      // For simplicity in SQLite/Postgres Drizzle, update one by one or with inArray if imported. 
      // Assuming unreadIds count is small.
      await db.execute(sql`UPDATE messages SET is_read = 1 WHERE id IN ${unreadIds} AND receiver_id = ${userId}`);
    }

    res.json({ messages: history });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch messages', details: err.message });
  }
});

import { getIo } from '../socket.js';

// POST /api/messages/:friendId (Send message)
messageRoutes.post('/api/messages/:friendId', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendId = req.params.friendId;
  const { encryptedContent, iv, sharedFileId } = req.body;

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
    }).returning();

    // Emit event for real-time delivery via SSE and Socket.IO
    chatEmitter.emit(`message:${friendId}`, msg);
    
    try {
      getIo().to(friendId).emit('new_message', msg);
    } catch(e) {
      console.warn('Socket not initialized or emit failed', e);
    }

    res.status(201).json({ success: true, message: msg });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

// GET /api/messages/events (SSE endpoint)
messageRoutes.get('/api/messages-events', (req, res) => {
  const userId = req.userId!;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onMessage = (msg: any) => {
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };

  chatEmitter.on(`message:${userId}`, onMessage);

  req.on('close', () => {
    chatEmitter.off(`message:${userId}`, onMessage);
  });
});
