import express from 'express';
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
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

import { clerkAuthMiddleware } from './auth/clerk.js';

import { publicRoutes } from './routes/public.js';
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

import { resolveStorage } from './storage/resolver.js';
import { createMockStorage } from './storage/mock.js';

const fallbackStorage = createMockStorage('public');

app.use(publicRoutes);

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

async function start() {
  await initDatabase();
  console.log('[server] Database initialized');

  startCleanupJob();
  
  app.listen(PORT, HOST, () => {
    console.log(`[server] LabRepo Express API running at http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
