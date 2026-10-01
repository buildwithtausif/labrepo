import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { users, files, userUsageStats } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { updateUserUsage } from '../services/usage.service.js';
import { evaluateAbuseSignals } from '../services/moderation.service.js';
import { getSecurityConfig } from '../services/config.service.js';
import { rateLimiter } from '../services/rate-limit.service.js';

const securityConfig = getSecurityConfig();

export const userRoutes = Router();

userRoutes.get('/api/user/status', async (req, res) => {
  const rateResult = rateLimiter.check(`login:${req.userId}`, { limit: securityConfig.loginRateLimit, windowMs: 60 * 1000 });
  if (!rateResult.allowed) {
    res.status(429).json({ error: 'Too many login requests. Please wait a minute before trying again.' });
    return;
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, req.userId))
    .limit(1);

  if (!user) {
    await db.insert(users).values({ clerkId: req.userId });
    await updateUserUsage({ userId: req.userId, loginDelta: 1, timestamp: new Date().toISOString() });
    await evaluateAbuseSignals({ userId: req.userId, action: 'login', ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ onboarding_completed: false, is_new: true });
    return;
  }

  await updateUserUsage({ userId: req.userId, loginDelta: 1, timestamp: new Date().toISOString() });
  await evaluateAbuseSignals({ userId: req.userId, action: 'login', ipAddress: req.ip, userAgent: req.headers['user-agent'] });

  res.json({
    onboarding_completed: Boolean(user.onboardingCompleted),
    is_new: false,
    uploads_suspended: Boolean(user.uploadsSuspended),
    suspension_reason: user.suspensionReason || null,
  });
});

userRoutes.post('/api/user/complete-onboarding', async (req, res) => {
  const db = getDb();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, req.userId))
    .limit(1);

  if (!user) {
    await db.insert(users).values({ clerkId: req.userId, onboardingCompleted: 1 });
  } else {
    await db
      .update(users)
      .set({ onboardingCompleted: 1, updatedAt: new Date().toISOString() })
      .where(eq(users.clerkId, req.userId));
  }

  await updateUserUsage({ userId: req.userId, loginDelta: 1, timestamp: new Date().toISOString() });
  res.json({ success: true });
});

userRoutes.get('/api/user/storage-stats', async (req, res) => {
  const db = getDb();

  const [stats] = await db
    .select({ storageUsed: userUsageStats.storageUsed })
    .from(userUsageStats)
    .where(eq(userUsageStats.userId, req.userId))
    .limit(1);

  const used = stats?.storageUsed || 0;
  const allocated = securityConfig.maxStoragePerUserBytes;

  const breakdown = await db
    .select({
      ext: files.extension,
      size: sql<number>`SUM(${files.sizeBytes})::int`,
    })
    .from(files)
    .where(eq(files.userId, req.userId))
    .groupBy(files.extension)
    .orderBy(sql`SUM(${files.sizeBytes}) DESC`);

  res.json({
    used,
    allocated,
    breakdown,
  });
});
