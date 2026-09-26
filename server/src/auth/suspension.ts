import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { getDb } from '../db/runtime.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

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
