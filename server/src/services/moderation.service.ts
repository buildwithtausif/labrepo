import { getDb } from '../db/runtime.js';
import { auditLogs, users, abuseFlags } from '../db/schema.js';
import { eq, and, gte, sql, count } from 'drizzle-orm';
import { writeAuditLog } from './audit.service.js';

export interface AbuseRuleResult {
  flagged: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high';
}

export async function evaluateAbuseSignals(input: {
  userId: string;
  action: 'upload' | 'download' | 'login' | 'repository_create';
  ipAddress?: string;
  userAgent?: string;
}): Promise<AbuseRuleResult> {
  const db = getDb();
  const now = new Date();
  const windowStartUpload = new Date(now.getTime() - 60 * 1000).toISOString(); // 1 minute
  const windowStartLogin = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1 hour

  if (input.action === 'upload') {
    const [result] = await db
      .select({ count: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, input.userId),
          eq(auditLogs.action, 'file_uploaded'),
          gte(auditLogs.createdAt, windowStartUpload),
        ),
      );

    if ((result?.count ?? 0) >= 50) {
      await createAbuseFlag(input.userId, 'UPLOAD_SPAM', 'high', 'Upload burst detected', input.ipAddress, input.userAgent);
      return { flagged: true, reason: 'Upload burst detected', severity: 'high' };
    }
  }

  if (input.action === 'login') {
    const [result] = await db
      .select({ count: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, input.userId),
          eq(auditLogs.action, 'failed_login'),
          gte(auditLogs.createdAt, windowStartLogin),
        ),
      );

    if ((result?.count ?? 0) >= 5) {
      await createAbuseFlag(input.userId, 'LOGIN_ATTACK', 'high', 'Repeated failed login attempts', input.ipAddress, input.userAgent);
      return { flagged: true, reason: 'Repeated failed login attempts', severity: 'high' };
    }
  }

  return { flagged: false };
}

async function createAbuseFlag(
  userId: string,
  type: string,
  severity: 'low' | 'medium' | 'high',
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  const db = getDb();

  await db.insert(abuseFlags).values({
    userId,
    type,
    severity,
    reason,
    resolved: 0,
    notes: JSON.stringify({ ipAddress, userAgent }),
  });

  if (severity === 'high') {
    const autoReason = 'System detected unusual activity. Your account has been temporarily restricted pending moderation review.';
    await db
      .update(users)
      .set({
        uploadsSuspended: 1,
        suspensionReason: autoReason,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.clerkId, userId));
  }

  await writeAuditLog({
    userId,
    action: 'abuse_flag_created',
    resourceType: 'abuse_flag',
    resourceId: null,
    ipAddress,
    userAgent,
    metadata: { type, severity, reason },
  });
}
