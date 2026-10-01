import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { getDb } from '../db/runtime.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Request, Response, NextFunction } from 'express';

/**
 * Checks if the current user is suspended.
 * If suspended, sends a 403 Forbidden response and returns true.
 * If not suspended, returns false.
 */
export async function requireNotSuspended(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const db = getDb();
  // @ts-ignore
  const userId = request.userId;
  if (!userId) return false;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  if (user?.uploadsSuspended) {
    reply.status(403).send({
      error: 'Your account has been suspended by an administrator. You cannot perform this action.',
    });
    return true;
  }

  return false;
}

/**
 * Express middleware to check if the current user is suspended.
 * If suspended, sends a 403 Forbidden response.
 * If not suspended, calls next().
 */
export async function requireNotSuspendedMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const db = getDb();
  const userId = req.userId;
  if (!userId) {
    next();
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  if (user?.uploadsSuspended) {
    res.status(403).json({
      error: 'Your account has been suspended by an administrator. You cannot perform this action.',
    });
    return;
  }

  next();
}
