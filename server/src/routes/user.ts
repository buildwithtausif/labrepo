import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/runtime.js';
import { users, files, userUsageStats } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { updateUserUsage } from '../services/usage.service.js';
import { evaluateAbuseSignals } from '../services/moderation.service.js';
import { getSecurityConfig } from '../services/config.service.js';
import { rateLimiter } from '../services/rate-limit.service.js';

const securityConfig = getSecurityConfig();

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // Get user status (onboarding state)
  fastify.get('/api/user/status', async (request, reply) => {
    const rateResult = rateLimiter.check(`login:${request.userId}`, { limit: securityConfig.loginRateLimit, windowMs: 60 * 1000 });
    if (!rateResult.allowed) {
      return reply.status(429).send({ error: 'Too many login requests. Please wait a minute before trying again.' });
    }

    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, request.userId))
      .limit(1);

    if (!user) {
      await db.insert(users).values({ clerkId: request.userId });
      await updateUserUsage({ userId: request.userId, loginDelta: 1, timestamp: new Date().toISOString() });
      await evaluateAbuseSignals({ userId: request.userId, action: 'login', ipAddress: request.ip, userAgent: request.headers['user-agent'] });
      return { onboarding_completed: false, is_new: true };
    }

    await updateUserUsage({ userId: request.userId, loginDelta: 1, timestamp: new Date().toISOString() });
    await evaluateAbuseSignals({ userId: request.userId, action: 'login', ipAddress: request.ip, userAgent: request.headers['user-agent'] });

    return {
      onboarding_completed: Boolean(user.onboardingCompleted),
      is_new: false,
      uploads_suspended: Boolean(user.uploadsSuspended),
      suspension_reason: user.suspensionReason || null,
    };
  });

  // Complete onboarding
  fastify.post('/api/user/complete-onboarding', async (request) => {
    const db = getDb();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, request.userId))
      .limit(1);

    if (!user) {
      await db.insert(users).values({ clerkId: request.userId, onboardingCompleted: 1 });
    } else {
      await db
        .update(users)
        .set({ onboardingCompleted: 1, updatedAt: new Date().toISOString() })
        .where(eq(users.clerkId, request.userId));
    }

    await updateUserUsage({ userId: request.userId, loginDelta: 1, timestamp: new Date().toISOString() });
    return { success: true };
  });

  // Get storage statistics
  fastify.get('/api/user/storage-stats', async (request) => {
    const db = getDb();

    const [stats] = await db
      .select({ storageUsed: userUsageStats.storageUsed })
      .from(userUsageStats)
      .where(eq(userUsageStats.userId, request.userId))
      .limit(1);

    const used = stats?.storageUsed || 0;
    const allocated = securityConfig.maxStoragePerUserBytes;

    const breakdown = await db
      .select({
        ext: files.extension,
        size: sql<number>`SUM(${files.sizeBytes})::int`,
      })
      .from(files)
      .where(eq(files.userId, request.userId))
      .groupBy(files.extension)
      .orderBy(sql`SUM(${files.sizeBytes}) DESC`);

    return {
      used,
      allocated,
      breakdown,
    };
  });
}

