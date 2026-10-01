import express from 'express';
import cors from 'cors';
import { initDatabase, closeDatabase } from './db/runtime.js';
import { startCleanupJob } from './jobs/cleanup.js';
import { getSecurityConfig } from './services/config.service.js';

const app = express();
// Bind to a different port temporarily so it doesn't conflict with Fastify if run together
const PORT = parseInt(process.env.API_PORT || '3002', 10);
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

// Custom JSON parser to safely handle empty bodies (mirroring Fastify custom parser behavior)
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

// Apply auth middleware to all subsequent routes
app.use(clerkAuthMiddleware);

// We will port routes in Phase 3
// app.use('/api/user', userRoutes);

async function start() {
  await initDatabase();
  console.log('[server-express] Database initialized');

  // We will initialize storage and routes in Phase 3
  
  app.listen(PORT, HOST, () => {
    console.log(`[server-express] LabRepo Express API running at http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server-express] Failed to start:', err);
  process.exit(1);
});
