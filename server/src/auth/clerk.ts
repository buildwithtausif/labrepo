import type { Request, Response, NextFunction } from 'express';
import { createClerkClient, verifyToken } from '@clerk/backend';

export const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY || 'dummy_key',
});

const DEV_ADMIN_ID = process.env.ADMIN_USER_ID || process.env.CLERK_ADMIN_USER_ID || 'mock_dev_admin';
const DEV_TEST_USER_ID = 'mock_test_user';

export const clerkAuthMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (
    req.path === '/health' ||
    req.path.startsWith('/api/announcements') ||
    req.path.startsWith('/api/public')
  ) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (process.env.ENV === 'development') {
      const cookieHeader = req.headers.cookie || '';
      const match = cookieHeader.match(/devmode_role=(devadmin|testuser)/);
      const role = match?.[1] || 'devadmin';
      req.userId = role === 'testuser' ? DEV_TEST_USER_ID : DEV_ADMIN_ID;
      return next();
    }
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    if (process.env.ENV === 'development') {
      const cookieHeader = req.headers.cookie || '';
      const match = cookieHeader.match(/devmode_role=(devadmin|testuser)/);
      const role = match?.[1] || 'devadmin';
      req.userId = role === 'testuser' ? DEV_TEST_USER_ID : DEV_ADMIN_ID;
      return next();
    }

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    if (!payload.sub) {
      res.status(401).json({ error: 'Invalid token: no subject' });
      return;
    }
    req.userId = payload.sub;
    next();
  } catch (err: any) {
    console.error('[clerkAuthMiddleware] Token verification failed:', err);
    res.status(401).json({ error: 'Invalid or expired token', details: err.message });
  }
};
