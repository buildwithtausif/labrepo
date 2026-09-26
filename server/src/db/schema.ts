import {
  pgTable,
  integer,
  text,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Helper: ISO timestamp default ────────────────────
const nowIso = sql`to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ─── Users ────────────────────────────────────────────
export const users = pgTable('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  clerkId: text('clerk_id').notNull().unique(),
  onboardingCompleted: integer('onboarding_completed').notNull().default(0),
  uploadsSuspended: integer('uploads_suspended').notNull().default(0),
  suspensionReason: text('suspension_reason'),
  allowedExtensions: text('allowed_extensions'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// ─── Academic Sessions ────────────────────────────────
export const academicSessions = pgTable(
  'academic_sessions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    autoDelete: integer('auto_delete').notNull().default(0),
    autoDeleteDate: text('auto_delete_date'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (table) => [
    uniqueIndex('academic_sessions_user_name_unique').on(table.userId, table.name),
    index('idx_sessions_user').on(table.userId),
  ],
);

// ─── Subjects ─────────────────────────────────────────
export const subjects = pgTable(
  'subjects',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    sessionId: integer('session_id')
      .notNull()
      .references(() => academicSessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (table) => [
    uniqueIndex('subjects_session_name_unique').on(table.sessionId, table.name),
    index('idx_subjects_session').on(table.sessionId),
    index('idx_subjects_user').on(table.userId),
  ],
);

// ─── Works ────────────────────────────────────────────
export const works = pgTable(
  'works',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    subjectId: integer('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (table) => [
    index('idx_works_subject').on(table.subjectId),
    index('idx_works_user').on(table.userId),
  ],
);

// ─── Files ────────────────────────────────────────────
export const files = pgTable(
  'files',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    workId: integer('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    filename: text('filename').notNull(),
    sanitizedFilename: text('sanitized_filename').notNull(),
    extension: text('extension').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (table) => [
    index('idx_files_work').on(table.workId),
    index('idx_files_user').on(table.userId),
  ],
);

// ─── Recycle Bin ──────────────────────────────────────
export const recycleBin = pgTable(
  'recycle_bin',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').notNull(),
    itemType: text('item_type').notNull(),
    itemId: integer('item_id').notNull(),
    originalData: text('original_data').notNull(),
    deletedAt: text('deleted_at').notNull().default(nowIso),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('idx_recycle_user').on(table.userId),
    index('idx_recycle_expires').on(table.expiresAt),
    check('recycle_bin_item_type_check', sql`${table.itemType} IN ('session', 'subject', 'work', 'file')`),
  ],
);

// ─── Audit Logs ───────────────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull().default(nowIso),
    metadata: text('metadata'),
  },
  (table) => [
    index('idx_audit_user').on(table.userId),
    index('idx_audit_created').on(table.createdAt),
    index('idx_audit_action').on(table.action),
  ],
);

// ─── User Usage Stats ─────────────────────────────────
export const userUsageStats = pgTable('user_usage_stats', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: text('user_id').notNull().unique(),
  storageUsed: integer('storage_used').notNull().default(0),
  repositoryCount: integer('repository_count').notNull().default(0),
  fileCount: integer('file_count').notNull().default(0),
  uploadsToday: integer('uploads_today').notNull().default(0),
  downloadsToday: integer('downloads_today').notNull().default(0),
  totalUploads: integer('total_uploads').notNull().default(0),
  totalDownloads: integer('total_downloads').notNull().default(0),
  lastUploadAt: text('last_upload_at'),
  lastLoginAt: text('last_login_at'),
});

// ─── Daily Usage History ──────────────────────────────
export const dailyUsageHistory = pgTable(
  'daily_usage_history',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').notNull(),
    date: text('date').notNull(),
    uploads: integer('uploads').notNull().default(0),
    downloads: integer('downloads').notNull().default(0),
    storageUsed: integer('storage_used').notNull().default(0),
    apiRequests: integer('api_requests').notNull().default(0),
    loginCount: integer('login_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('daily_usage_user_date_unique').on(table.userId, table.date),
  ],
);

// ─── Abuse Flags ──────────────────────────────────────
export const abuseFlags = pgTable(
  'abuse_flags',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    severity: text('severity').notNull(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
    resolved: integer('resolved').notNull().default(0),
    resolvedBy: text('resolved_by'),
    notes: text('notes'),
  },
  (table) => [
    index('idx_abuse_user').on(table.userId),
    index('idx_abuse_resolved').on(table.resolved),
  ],
);

// ─── Site Settings (SEO, Config) ──────────────────────
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(nowIso),
});


// ─── Announcements ────────────────────────────────────
export const announcements = pgTable(
  'announcements',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    url: text('url'),
    urlLabel: text('url_label'),
    type: text('type').notNull().default('info'), // info, success, warning, critical
    isActive: integer('is_active').notNull().default(1),
    startsAt: text('starts_at'),
    expiresAt: text('expires_at'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (table) => [
    index('idx_announcements_active').on(table.isActive),
    check('announcements_type_check', sql`${table.type} IN ('info', 'success', 'warning', 'critical')`),
  ],
);
