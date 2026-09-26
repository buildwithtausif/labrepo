import { index, integer, pgTable, serial, text, uniqueIndex, } from 'drizzle-orm/pg-core';
export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    clerkId: text('clerk_id').notNull().unique(),
    onboardingCompleted: integer('onboarding_completed').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
});
export const academicSessions = pgTable('academic_sessions', {
    id: serial('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    autoDelete: integer('auto_delete').notNull().default(0),
    autoDeleteDate: text('auto_delete_date'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
}, (table) => ({
    userNameUnique: uniqueIndex('academic_sessions_user_name_unique').on(table.userId, table.name),
    userIndex: index('idx_sessions_user').on(table.userId),
}));
export const subjects = pgTable('subjects', {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
        .notNull()
        .references(() => academicSessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
}, (table) => ({
    sessionNameUnique: uniqueIndex('subjects_session_name_unique').on(table.sessionId, table.name),
    sessionIndex: index('idx_subjects_session').on(table.sessionId),
    userIndex: index('idx_subjects_user').on(table.userId),
}));
export const works = pgTable('works', {
    id: serial('id').primaryKey(),
    subjectId: integer('subject_id')
        .notNull()
        .references(() => subjects.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
}, (table) => ({
    subjectIndex: index('idx_works_subject').on(table.subjectId),
    userIndex: index('idx_works_user').on(table.userId),
}));
export const files = pgTable('files', {
    id: serial('id').primaryKey(),
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
    createdAt: text('created_at').notNull(),
}, (table) => ({
    workIndex: index('idx_files_work').on(table.workId),
    userIndex: index('idx_files_user').on(table.userId),
}));
export const recycleBin = pgTable('recycle_bin', {
    id: serial('id').primaryKey(),
    userId: text('user_id').notNull(),
    itemType: text('item_type').notNull(),
    itemId: integer('item_id').notNull(),
    originalData: text('original_data').notNull(),
    deletedAt: text('deleted_at').notNull(),
    expiresAt: text('expires_at').notNull(),
}, (table) => ({
    userIndex: index('idx_recycle_user').on(table.userId),
    expiresIndex: index('idx_recycle_expires').on(table.expiresAt),
}));
export const drizzleSchema = {
    users,
    academicSessions,
    subjects,
    works,
    files,
    recycleBin,
};
