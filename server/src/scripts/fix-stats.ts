import { getDb, initDatabase, closeDatabase } from '../db/runtime.js';
import { userUsageStats, files, users } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

async function fixStats() {
  await initDatabase();
  console.log('Recalculating usage stats based on active files...');
  const db = getDb();
  
  const allUsers = await db.select({ id: users.clerkId }).from(users);
  
  for (const user of allUsers) {
    const [fileStats] = await db
      .select({
        totalSize: sql<number>`COALESCE(SUM(${files.sizeBytes}), 0)`,
        count: sql<number>`COUNT(${files.id})`
      })
      .from(files)
      .where(eq(files.userId, user.id));
      
    await db
      .update(userUsageStats)
      .set({
        storageUsed: Number(fileStats.totalSize),
        fileCount: Number(fileStats.count)
      })
      .where(eq(userUsageStats.userId, user.id));
      
    console.log(`Updated user ${user.id} -> ${fileStats.count} files, ${fileStats.totalSize} bytes`);
  }
  
  console.log('Done!');
  await closeDatabase();
  process.exit(0);
}

fixStats().catch(console.error);
