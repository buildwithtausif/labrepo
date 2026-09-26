import { getDb } from '../db/runtime.js';
import { auditLogs } from '../db/schema.js';

export interface AuditLogPayload {
  userId: string;
  action: string;
  resourceType?: string;
  resourceId?: string | number | null;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(payload: AuditLogPayload): Promise<void> {
  const db = getDb();
  await db.insert(auditLogs).values({
    userId: payload.userId,
    action: payload.action,
    resourceType: payload.resourceType ?? null,
    resourceId: payload.resourceId != null ? String(payload.resourceId) : null,
    ipAddress: payload.ipAddress ?? null,
    userAgent: payload.userAgent ?? null,
    createdAt: new Date().toISOString(),
    metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
  });
}
