import { getDb } from '../db/runtime.js';
import { userUsageStats, dailyUsageHistory } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

interface UsageUpdateOptions {
  userId: string;
  storageDelta?: number;
  fileDelta?: number;
  repositoryDelta?: number;
  uploadDelta?: number;
  downloadDelta?: number;
  loginDelta?: number;
  timestamp?: string;
}

export async function updateUserUsage(options: UsageUpdateOptions): Promise<void> {
  const db = getDb();
  const timestamp = options.timestamp ?? new Date().toISOString();
  const today = timestamp.split('T')[0];

  // Upsert user_usage_stats
  await db
    .insert(userUsageStats)
    .values({
      userId: options.userId,
      storageUsed: options.storageDelta ?? 0,
      repositoryCount: options.repositoryDelta ?? 0,
      fileCount: options.fileDelta ?? 0,
      uploadsToday: options.uploadDelta ?? 0,
      downloadsToday: options.downloadDelta ?? 0,
      totalUploads: options.uploadDelta ?? 0,
      totalDownloads: options.downloadDelta ?? 0,
      lastUploadAt: options.uploadDelta !== undefined ? timestamp : null,
      lastLoginAt: options.loginDelta !== undefined ? timestamp : null,
    })
    .onConflictDoUpdate({
      target: userUsageStats.userId,
      set: {
        storageUsed: sql`${userUsageStats.storageUsed} + ${options.storageDelta ?? 0}`,
        repositoryCount: sql`${userUsageStats.repositoryCount} + ${options.repositoryDelta ?? 0}`,
        fileCount: sql`${userUsageStats.fileCount} + ${options.fileDelta ?? 0}`,
        uploadsToday: sql`${userUsageStats.uploadsToday} + ${options.uploadDelta ?? 0}`,
        downloadsToday: sql`${userUsageStats.downloadsToday} + ${options.downloadDelta ?? 0}`,
        totalUploads: sql`${userUsageStats.totalUploads} + ${options.uploadDelta ?? 0}`,
        totalDownloads: sql`${userUsageStats.totalDownloads} + ${options.downloadDelta ?? 0}`,
        lastUploadAt: options.uploadDelta !== undefined
          ? sql`${timestamp}`
          : sql`${userUsageStats.lastUploadAt}`,
        lastLoginAt: options.loginDelta !== undefined
          ? sql`${timestamp}`
          : sql`${userUsageStats.lastLoginAt}`,
      },
    });

  // Upsert daily_usage_history
  await db
    .insert(dailyUsageHistory)
    .values({
      userId: options.userId,
      date: today,
      uploads: options.uploadDelta ?? 0,
      downloads: options.downloadDelta ?? 0,
      storageUsed: options.storageDelta ?? 0,
      apiRequests: 1,
      loginCount: options.loginDelta ?? 0,
    })
    .onConflictDoUpdate({
      target: [dailyUsageHistory.userId, dailyUsageHistory.date],
      set: {
        uploads: sql`${dailyUsageHistory.uploads} + ${options.uploadDelta ?? 0}`,
        downloads: sql`${dailyUsageHistory.downloads} + ${options.downloadDelta ?? 0}`,
        storageUsed: sql`${dailyUsageHistory.storageUsed} + ${options.storageDelta ?? 0}`,
        apiRequests: sql`${dailyUsageHistory.apiRequests} + 1`,
        loginCount: sql`${dailyUsageHistory.loginCount} + ${options.loginDelta ?? 0}`,
      },
    });
}
