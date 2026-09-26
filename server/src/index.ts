import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { initDatabase, closeDatabase } from './db/runtime.js';
import { clerkAuth } from './auth/clerk.js';
import { MockS3Adapter } from './storage/mock-s3.js';
import { userRoutes } from './routes/user.js';
import { sessionRoutes } from './routes/sessions.js';
import { subjectRoutes } from './routes/subjects.js';
import { workRoutes } from './routes/works.js';
import { createFileRoutes } from './routes/files.js';
import { createDownloadRoutes } from './routes/download.js';
import { createRecycleBinRoutes } from './routes/recycle-bin.js';
import { searchRoutes } from './routes/search.js';
import { publicRoutes } from './routes/public.js';
import { startCleanupJob } from './jobs/cleanup.js';
import { getSecurityConfig } from './services/config.service.js';

const PORT = parseInt(process.env.API_PORT || '3001', 10);
const HOST = process.env.API_HOST || '0.0.0.0';
const securityConfig = getSecurityConfig();

// Determine CORS origins from environment or defaults
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

async function start() {
  // Initialize database (runs migrations — blocks if they fail)
  await initDatabase();
  console.log('[server] Database initialized (PostgreSQL + Drizzle ORM)');

  // Initialize storage adapter based on environment variable
  const storageDriver = process.env.STORAGE_DRIVER || 'mock';
  let storage;
  
  if (storageDriver === 'minio' || storageDriver === 's3') {
    const { S3Adapter } = await import('./storage/s3.js');
    const s3Adapter = new S3Adapter();
    await s3Adapter.initBucket();
    storage = s3Adapter;
    console.log(`[server] Storage adapter initialized (${storageDriver === 'minio' ? 'MinIO' : 'AWS S3'})`);
  } else {
    storage = new MockS3Adapter();
    console.log('[server] Storage adapter initialized (MockS3)');
  }

  // Create Fastify instance
  const fastify = Fastify({
    logger: true,
  });

  // Custom JSON parser to safely handle empty bodies
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      if (!body || (body as string).trim() === '') {
        done(null, {});
      } else {
        done(null, JSON.parse(body as string));
      }
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Register CORS
  await fastify.register(cors, {
    origin: getCorsOrigins(),
    credentials: true,
  });

  // Register multipart support (for file uploads)
  await fastify.register(multipart, {
    limits: {
      fileSize: securityConfig.maxUploadBytes,
      files: 20,
    },
  });

  // Health check (no auth required)
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Public proxy for storage (e.g. for SEO OG images)
  fastify.get<{ Params: { '*': string } }>('/api/public/storage/*', async (request, reply) => {
    const key = request.params['*'];
    if (!key || key.includes('..')) {
      return reply.status(400).send({ error: 'Invalid path' });
    }
    try {
      const { data, contentType } = await storage.download(key);
      return reply.header('Content-Type', contentType).send(data);
    } catch (err) {
      return reply.status(404).send({ error: 'Not found' });
    }
  });

  // Public announcements API (no auth required)
  await fastify.register(publicRoutes);

  // Register auth plugin (all routes below require authentication)
  await fastify.register(clerkAuth);

  // Register routes
  await fastify.register(userRoutes);
  await fastify.register(sessionRoutes);
  await fastify.register(subjectRoutes);
  await fastify.register(workRoutes);
  await fastify.register(createFileRoutes(storage));
  await fastify.register(createDownloadRoutes(storage));
  await fastify.register(createRecycleBinRoutes(storage));
  

  await fastify.register(searchRoutes);
  
  const { createAdminRoutes } = await import('./routes/admin.js');
  await fastify.register(createAdminRoutes(storage));

  // Start cleanup job
  startCleanupJob(storage);
  console.log('[server] Cleanup job started');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[server] Shutting down...');
    await fastify.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`[server] LabRepo API running at http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
