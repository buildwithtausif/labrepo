import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { friendships, users } from '../db/schema.js';
import { eq, or, and, inArray } from 'drizzle-orm';
import { clerkClient } from '../auth/clerk.js';
import { getIo } from '../socket.js';

export const friendRoutes = Router();

// Helper to get formatted username from clerk user object
function getUsername(user: any) {
  return user.username || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : (user.firstName || 'Unknown User'));
}

function getAvatar(user: any) {
  return user.imageUrl || user.profileImageUrl || '';
}

// List all friendships for the current user
friendRoutes.get('/api/users/:id', async (req, res) => {
  try {
    const user = await clerkClient.users.getUser(req.params.id);
    const adminId = process.env.ADMIN_USER_ID || process.env.CLERK_ADMIN_USER_ID;
    const isAdmin = user.id === adminId || user.publicMetadata?.role === 'admin';
    res.json({
      username: getUsername(user),
      avatar: getAvatar(user),
      isAdmin
    });
  } catch (err: any) {
    res.status(404).json({ error: 'User not found' });
  }
});

friendRoutes.get('/api/friends', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;

  try {
    const userFriendships = await db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, userId), eq(friendships.receiverId, userId)));

    const friendIds = new Set<string>();
    for (const f of userFriendships) {
      if (f.requesterId !== userId) friendIds.add(f.requesterId);
      if (f.receiverId !== userId) friendIds.add(f.receiverId);
    }

    const friendsData: Record<string, { username: string, avatar: string, bio: string, isAdmin?: boolean }> = {};
    const adminId = process.env.ADMIN_USER_ID || process.env.CLERK_ADMIN_USER_ID;
    
    if (friendIds.size > 0) {
      const friendIdsArray = Array.from(friendIds);
      
      // Fetch clerk profiles
      const clerkUsers = await clerkClient.users.getUserList({
        userId: friendIdsArray
      });
      
      // Fetch DB bios
      const dbUsers = await db.select({ clerkId: users.clerkId, bio: users.bio })
        .from(users)
        .where(inArray(users.clerkId, friendIdsArray));

      const bioMap = new Map(dbUsers.map(u => [u.clerkId, u.bio || '']));

      for (const cu of clerkUsers.data) {
        const isAdmin = cu.id === adminId || cu.publicMetadata?.role === 'admin';
        friendsData[cu.id] = { 
          username: getUsername(cu),
          avatar: getAvatar(cu),
          bio: bioMap.get(cu.id) || '',
          isAdmin
        };
      }
    }

    const formattedFriendships = userFriendships.map(f => {
      const isRequester = f.requesterId === userId;
      const otherId = isRequester ? f.receiverId : f.requesterId;
      return {
        id: f.id,
        friendId: otherId,
        username: friendsData[otherId]?.username || 'Unknown User',
        avatar: friendsData[otherId]?.avatar || '',
        bio: friendsData[otherId]?.bio || '',
        isAdmin: friendsData[otherId]?.isAdmin || false,
        status: f.status,
        isOutgoing: isRequester,
        createdAt: f.createdAt,
      };
    });

    res.json({ friendships: formattedFriendships });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch friends', details: err.message });
  }
});



// Discover users via fuzzy search
friendRoutes.get('/api/friends/discover', async (req, res) => {
  const query = req.query.q as string;

  try {
    const db = getDb();
    const userId = req.userId!;

    // Query clerk for users
    let clerkUsers;
    if (!query || query.length < 2) {
      clerkUsers = await clerkClient.users.getUserList({ limit: 50 }); // Fetch top 50 if no query
    } else {
      clerkUsers = await clerkClient.users.getUserList({ query: query, limit: 20 });
    }

    // Exclude self
    const filteredUsers = clerkUsers.data.filter(u => u.id !== userId);

    if (filteredUsers.length === 0) {
      return res.json({ users: [] });
    }

    const userIds = filteredUsers.map(u => u.id);

    // Fetch bios
    const dbUsers = await db.select({ clerkId: users.clerkId, bio: users.bio })
      .from(users)
      .where(inArray(users.clerkId, userIds));
    const bioMap = new Map(dbUsers.map(u => [u.clerkId, u.bio || '']));

    // Get current friendships
    const userFriendships = await db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, userId), eq(friendships.receiverId, userId)));

    const friendshipMap = new Map();
    for (const f of userFriendships) {
      const otherId = f.requesterId === userId ? f.receiverId : f.requesterId;
      friendshipMap.set(otherId, f);
    }

    const adminId = process.env.ADMIN_USER_ID || process.env.CLERK_ADMIN_USER_ID;

    const result = filteredUsers.map(u => {
      const existing = friendshipMap.get(u.id);
      const isAdmin = u.id === adminId || u.publicMetadata?.role === 'admin';
      return {
        id: u.id,
        username: getUsername(u),
        avatar: getAvatar(u),
        bio: bioMap.get(u.id) || '',
        isAdmin,
        friendshipStatus: existing ? existing.status : 'none',
        isOutgoing: existing ? existing.requesterId === userId : false
      };
    });

    res.json({ users: result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to discover users', details: err.message });
  }
});

// Send a friend request
friendRoutes.post('/api/friends/request', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const { clerkId } = req.body;

  if (!clerkId) return res.status(400).json({ error: 'Missing clerkId' });
  if (clerkId === userId) return res.status(400).json({ error: 'Cannot send request to yourself' });

  try {
    const [existing] = await db
      .select()
      .from(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, userId), eq(friendships.receiverId, clerkId)),
          and(eq(friendships.requesterId, clerkId), eq(friendships.receiverId, userId))
        )
      )
      .limit(1);

    if (existing) return res.status(400).json({ error: 'Friendship or request already exists' });

    const [newRequest] = await db.insert(friendships).values({
      requesterId: userId,
      receiverId: clerkId,
      status: 'pending',
    }).returning();

    try {
      getIo().to(clerkId).emit('friend_request', newRequest);
    } catch (e) {
      console.warn('Failed to emit friend_request', e);
    }

    res.status(201).json({ success: true, friendship: newRequest });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to send request', details: err.message });
  }
});

// Accept a friend request
friendRoutes.post('/api/friends/:id/accept', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendshipId = parseInt(req.params.id, 10);

  if (isNaN(friendshipId)) return res.status(400).json({ error: 'Invalid friendship ID' });

  try {
    const [friendship] = await db
      .select()
      .from(friendships)
      .where(and(eq(friendships.id, friendshipId), eq(friendships.receiverId, userId)))
      .limit(1);

    if (!friendship) return res.status(404).json({ error: 'Friend request not found or you are not the receiver' });
    if (friendship.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

    await db.update(friendships).set({ status: 'accepted', updatedAt: new Date().toISOString() }).where(eq(friendships.id, friendshipId));
    
    try {
      getIo().to(friendship.requesterId).emit('friend_accepted', friendship);
    } catch (e) {
      console.warn('Failed to emit friend_accepted', e);
    }
    
    res.json({ success: true, message: 'Friend request accepted' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to accept request', details: err.message });
  }
});

// Cancel request, reject, or remove friend
friendRoutes.delete('/api/friends/:id', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const friendshipId = parseInt(req.params.id, 10);

  if (isNaN(friendshipId)) return res.status(400).json({ error: 'Invalid friendship ID' });

  try {
    const [friendship] = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, friendshipId))
      .limit(1);

    if (!friendship) return res.status(404).json({ error: 'Friendship not found' });
    if (friendship.requesterId !== userId && friendship.receiverId !== userId) return res.status(403).json({ error: 'Not authorized to delete this friendship' });

    await db.delete(friendships).where(eq(friendships.id, friendshipId));
    
    try {
      const otherId = friendship.requesterId === userId ? friendship.receiverId : friendship.requesterId;
      getIo().to(otherId).emit('friend_removed', { friendshipId });
    } catch (e) {
      console.warn('Failed to emit friend_removed', e);
    }

    res.json({ success: true, message: 'Friendship deleted' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete friendship', details: err.message });
  }
});

// Update bio
friendRoutes.post('/api/friends/bio', async (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  const { bio } = req.body;

  try {
    await db.update(users).set({ bio }).where(eq(users.clerkId, userId));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update bio', details: err.message });
  }
});
