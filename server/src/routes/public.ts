import { FastifyInstance } from 'fastify';
import { getDb } from '../db/runtime.js';
import { announcements } from '../db/schema.js';
import { eq, and, sql, or, isNull } from 'drizzle-orm';

export async function publicRoutes(fastify: FastifyInstance) {
  fastify.get('/api/announcements/active', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    
    const active = await db.select().from(announcements).where(
      and(
        eq(announcements.isActive, 1),
        or(isNull(announcements.startsAt), sql`${announcements.startsAt} <= ${now}`),
        or(isNull(announcements.expiresAt), sql`${announcements.expiresAt} >= ${now}`)
      )
    );
    
    return { announcements: active };
  });

  fastify.get('/api/public/seo', async () => {
    const db = getDb();
    const { siteSettings } = await import('../db/schema.js');
    const settings = await db.select().from(siteSettings).where(sql`${siteSettings.key} LIKE 'seo.%'`);
    const seo: Record<string, string> = {};
    for (const s of settings) {
      seo[s.key.replace('seo.', '')] = s.value;
    }
    return { seo };
  });
}
