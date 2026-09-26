export interface AuditLogPayload {
    userId: string;
    action: string;
    resourceType?: string;
    resourceId?: string | number | null;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
}
export declare function writeAuditLog(payload: AuditLogPayload): Promise<void>;
