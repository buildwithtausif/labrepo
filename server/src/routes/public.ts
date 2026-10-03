import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { announcements } from '../db/schema.js';
import { eq, and, sql, or, isNull } from 'drizzle-orm';
import type { StorageAdapter } from '../storage/adapter.js';

export function createPublicRoutes(fallbackStorage: StorageAdapter) {
  const router = Router();

  router.get('/api/announcements/active', async (req, res) => {
    const db = getDb();
    const now = new Date().toISOString();
    
    const active = await db.select().from(announcements).where(
      and(
        eq(announcements.isActive, 1),
        or(isNull(announcements.startsAt), sql`${announcements.startsAt} <= ${now}`),
        or(isNull(announcements.expiresAt), sql`${announcements.expiresAt} >= ${now}`)
      )
    );
    
    res.json({ announcements: active });
  });

  router.get('/api/public/seo', async (req, res) => {
    const db = getDb();
    const { siteSettings } = await import('../db/schema.js');
    const settings = await db.select().from(siteSettings).where(sql`${siteSettings.key} LIKE 'seo.%'`);
    const seo: Record<string, string> = {};
    for (const s of settings) {
      seo[s.key.replace('seo.', '')] = s.value;
    }
    res.json({ seo });
  });

  router.get('/api/public/storage/*', async (req, res) => {
    try {
      const key = (req.params as any)[0];
      if (!key) {
        res.status(400).json({ error: 'Key required' });
        return;
      }
      const { data, contentType } = await fallbackStorage.download(key);
      res.set('Content-Type', contentType);
      res.send(data);
    } catch (err) {
      res.status(404).json({ error: 'Public asset not found' });
    }
  });

  return router;
}
