import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { verifyToken } from '@clerk/backend';

let io: SocketIOServer;

const DEV_ADMIN_ID = process.env.ADMIN_USER_ID || process.env.CLERK_ADMIN_USER_ID || 'mock_dev_admin';
const DEV_TEST_USER_ID = 'mock_test_user';

export function initSocket(server: HTTPServer) {
  io = new SocketIOServer(server, {
    cors: {
      origin: "*", // Or specific origins if required
      methods: ["GET", "POST"]
    }
  });

  io.use(async (socket, next) => {
    let token = socket.handshake.auth.token || socket.handshake.query.token;
    if (token === 'null' || token === 'undefined') token = undefined;
    const isDevMode = process.env.ENV?.trim() === 'development' || process.env.NODE_ENV === 'development';

    if (!token) {
      if (isDevMode) {
        // Fallback for dev mode
        const cookieHeader = socket.handshake.headers.cookie || '';
        const match = cookieHeader.match(/devmode_role=(devadmin|testuser)/);
        const role = match?.[1] || 'devadmin';
        (socket as any).userId = role === 'testuser' ? DEV_TEST_USER_ID : DEV_ADMIN_ID;
        return next();
      }
      return next(new Error('Authentication error: Token missing'));
    }

    try {
      if (isDevMode) {
        const cookieHeader = socket.handshake.headers.cookie || '';
        const match = cookieHeader.match(/devmode_role=(devadmin|testuser)/);
        const role = match?.[1] || 'devadmin';
        (socket as any).userId = role === 'testuser' ? DEV_TEST_USER_ID : DEV_ADMIN_ID;
        return next();
      }

      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      if (!payload.sub) {
        return next(new Error('Authentication error: Invalid token'));
      }
      (socket as any).userId = payload.sub;
      next();
    } catch (err) {
      console.error('[Socket Auth Error]', err);
      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket as any).userId;
    console.log(`[Socket] User connected: ${userId} (${socket.id})`);
    
    // Join room for this specific user
    socket.join(userId);
    
    // Typing indicators
    socket.on('typing', (data: { friendId: string, isTyping: boolean }) => {
      if (data && data.friendId) {
        socket.to(data.friendId).emit('friend_typing', { friendId: userId, isTyping: data.isTyping });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${userId} (${socket.id})`);
      // Could broadcast offline presence here
    });
  });

  return io;
}

export function getIo(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.io is not initialized');
  }
  return io;
}
