import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import { initDatabase, closeDatabase } from './db/runtime.js';
import { startCleanupJob } from './jobs/cleanup.js';
import { getSecurityConfig } from './services/config.service.js';

const app = express();
const PORT = parseInt(process.env.API_PORT || '3001', 10);
const HOST = process.env.API_HOST || '0.0.0.0';
const securityConfig = getSecurityConfig();

// Determine CORS origins
function getCorsOrigins(): string[] {
  const envOrigins = process.env.CORS_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  }
  return [
    'http://localhost:4321',
    'http://localhost:3000',
    'http://127.0.0.1:4321',
    'http://127.0.0.1:3000',
  ];
}

app.use(cors({
  origin: getCorsOrigins(),
  credentials: true,
}));

// Custom JSON parser to safely handle empty bodies
app.use(express.json({ strict: false }));
app.use((req, res, next) => {
  if (req.body === '' || req.body === undefined) {
    req.body = {};
  }
  next();
});

// Health check (no auth required)
app.get('/health', async (req, res) => {
  let dbStatus = 'operational';
  let storageStatus = 'operational';

  try {
    const { getDb } = await import('./db/runtime.js');
    const { sql } = await import('drizzle-orm');
    const db = getDb();
    await db.execute(sql`SELECT 1`);
  } catch (e) {
    console.error("DB health check failed:", e);
    dbStatus = 'down';
  }

  try {
    await fallbackStorage.exists('health-check-ping');
  } catch (e) {
    console.error("Storage health check failed:", e);
    storageStatus = 'down';
  }

  res.json({
    status: (dbStatus === 'down' || storageStatus === 'down') ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    db: dbStatus,
    storage: storageStatus
  });
});

import { clerkAuthMiddleware } from './auth/clerk.js';

import { createPublicRoutes } from './routes/public.js';
import { userRoutes } from './routes/user.js';
import { searchRoutes } from './routes/search.js';
import { sessionRoutes } from './routes/sessions.js';
import { subjectRoutes } from './routes/subjects.js';
import { workRoutes } from './routes/works.js';
import { createFileRoutes } from './routes/files.js';
import { createDownloadRoutes } from './routes/download.js';
import { createRecycleBinRoutes } from './routes/recycle-bin.js';
import { createAdminRoutes } from './routes/admin.js';
import { gdriveAuthRoutes } from './routes/gdrive-auth.js';

import { requireGDriveAdapter } from './storage/resolver.js';
import { MockS3Adapter } from './storage/mock-s3.js';
import type { StorageAdapter } from './storage/adapter.js';

const fallbackStorage = new MockS3Adapter();

async function resolveStorage(userId: string): Promise<StorageAdapter> {
  const driver = process.env.STORAGE_DRIVER || 'mock';
  if (driver === 'gdrive') {
    return await requireGDriveAdapter(userId);
  }
  return fallbackStorage;
}


app.use(createPublicRoutes(fallbackStorage));

// Apply auth middleware to all subsequent routes
app.use(clerkAuthMiddleware);

app.use(userRoutes);
app.use(searchRoutes);
app.use(sessionRoutes);
app.use(subjectRoutes);
app.use(workRoutes);
app.use(createFileRoutes(resolveStorage));
app.use(createDownloadRoutes(resolveStorage));
app.use(createRecycleBinRoutes(resolveStorage));
app.use(createAdminRoutes(resolveStorage, fallbackStorage));
app.use(gdriveAuthRoutes());

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error Handled]', err.message);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    code: status,
  });
});

async function start() {
  await initDatabase();
  console.log('[server] Database initialized');

  startCleanupJob(process.env.STORAGE_DRIVER || 'mock', fallbackStorage);
  
  app.listen(PORT, HOST, () => {
    console.log(`[server] LabRepo Express API running at http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
