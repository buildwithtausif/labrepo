import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/runtime.js';
import { files, works, subjects, academicSessions, recycleBin } from '../db/schema.js';
import type { StorageAdapter } from '../storage/adapter.js';
import { buildStorageKey } from '../storage/adapter.js';
import { validateUploadCandidate } from '../services/validation.service.js';
import { writeAuditLog } from '../services/audit.service.js';
import { updateUserUsage } from '../services/usage.service.js';
import { evaluateAbuseSignals } from '../services/moderation.service.js';
import { getSecurityConfig, getDynamicSecurityConfig } from '../services/config.service.js';
import { rateLimiter } from '../services/rate-limit.service.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireNotSuspended } from '../auth/suspension.js';
import sharp from 'sharp';

const securityConfig = getSecurityConfig();

// Text-based extensions that support preview
const TEXT_EXTENSIONS = new Set([
  'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'cs', 'go',
  'rs', 'swift', 'php', 'rb', 'r', 'scala', 'sql', 'html', 'css', 'scss',
  'json', 'yaml', 'yml', 'xml', 'md', 'txt', 'csv', 'ipynb',
  'env', 'sh', 'bat', 'ps1', 'toml', 'ini', 'cfg', 'conf', 'log', 'dockerfile', 'tex', 'rtf',
]);

const MAX_UPLOAD_SIZE = securityConfig.maxUploadBytes;

function getExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

function getContentType(ext: string): string {
  const types: Record<string, string> = {
    'py': 'text/x-python', 'js': 'text/javascript', 'mjs': 'text/javascript', 'cjs': 'text/javascript', 'jsx': 'text/jsx',
    'ts': 'text/typescript', 'tsx': 'text/tsx', 'c': 'text/x-c', 'h': 'text/x-c', 'hpp': 'text/x-c++src',
    'cpp': 'text/x-c++src', 'java': 'text/x-java', 'kt': 'text/x-kotlin',
    'cs': 'text/x-csharp', 'go': 'text/x-go', 'rs': 'text/x-rust',
    'swift': 'text/x-swift', 'php': 'text/x-php', 'rb': 'text/x-ruby',
    'r': 'text/x-r', 'scala': 'text/x-scala', 'sql': 'text/x-sql',
    'html': 'text/html', 'css': 'text/css', 'scss': 'text/x-scss',
    'json': 'application/json', 'yaml': 'text/yaml', 'yml': 'text/yaml',
    'xml': 'application/xml', 'md': 'text/markdown', 'txt': 'text/plain',
    'csv': 'text/csv', 'ipynb': 'application/x-ipynb+json',
    'env': 'text/plain', 'sh': 'application/x-sh', 'bat': 'application/x-msdownload', 'ps1': 'text/plain',
    'toml': 'text/plain', 'ini': 'text/plain', 'cfg': 'text/plain', 'conf': 'text/plain', 'log': 'text/plain', 'dockerfile': 'text/plain',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'rtf': 'application/rtf',
    'tex': 'application/x-tex',
  };
  return types[ext] || 'application/octet-stream';
}

export function createFileRoutes(storage: StorageAdapter) {
  return async function fileRoutes(fastify: FastifyInstance): Promise<void> {
    // Upload files to a work
    fastify.post<{ Params: { workId: string } }>(
      '/api/works/:workId/files',
      async (request, reply) => {
        const db = getDb();

        // Verify work ownership and get path info
        const [work] = await db
          .select({
            id: works.id,
            title: works.title,
            subject_name: subjects.name,
            session_name: academicSessions.name,
          })
          .from(works)
          .innerJoin(subjects, eq(works.subjectId, subjects.id))
          .innerJoin(academicSessions, eq(subjects.sessionId, academicSessions.id))
          .where(and(
            eq(works.id, Number(request.params.workId)),
            eq(works.userId, request.userId),
          ))
          .limit(1);

        if (!work) {
          return reply.status(404).send({ error: 'Work not found' });
        }

        // Apply rate limit
        const rateResult = rateLimiter.check(`upload:${request.userId}`, { limit: securityConfig.uploadRateLimit, windowMs: 60 * 1000 });
        if (!rateResult.allowed) {
          return reply.status(429).send({ error: 'Too many uploads per minute. Please slow down.' });
        }

        // Check if uploads are suspended
        if (await requireNotSuspended(request, reply)) return;

        const parts = request.parts();
        const uploadedFiles: (typeof files.$inferSelect)[] = [];
        let totalSize = 0;

        for await (const part of parts) {
          if (part.type !== 'file') continue;

          const filename = part.filename;
          if (!filename) continue;

          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          const data = Buffer.concat(chunks);

          // Fetch dynamic security config
          const dynamicConfig = await getDynamicSecurityConfig(db, request.userId);
          const ALLOWED_EXTENSIONS = new Set(dynamicConfig.allowedExtensions);
          const MAX_UPLOAD_SIZE = dynamicConfig.maxUploadBytes;

          const validation = validateUploadCandidate({
            filename,
            size: data.length,
            contentType: part.mimetype,
            allowedExtensions: ALLOWED_EXTENSIONS,
            maxBytes: MAX_UPLOAD_SIZE,
          });

          if (!validation.valid) {
            return reply.status(400).send({
              error: validation.reason,
              allowed: Array.from(ALLOWED_EXTENSIONS),
            });
          }

          const ext = validation.extension ?? getExtension(filename);
          const sanitized = validation.sanitizedFilename ?? filename;
          const storageKey = buildStorageKey(
            request.userId,
            work.session_name,
            work.subject_name,
            work.title,
            sanitized,
          );
          const contentType = validation.contentType ?? getContentType(ext);
          let finalData = data;
          let finalMime = contentType;

          // Apply intelligent image compression (skip SVG and non-images)
          if (contentType.startsWith('image/') && contentType !== 'image/svg+xml') {
            try {
              const image = sharp(data).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true });
              if (contentType === 'image/jpeg' || contentType === 'image/jpg') {
                finalData = await image.jpeg({ quality: 82 }).toBuffer();
              } else if (contentType === 'image/png') {
                finalData = await image.png({ quality: 82, compressionLevel: 9 }).toBuffer();
              } else if (contentType === 'image/webp') {
                finalData = await image.webp({ quality: 82 }).toBuffer();
              }
            } catch (err) {
              console.warn('Image compression failed, using original buffer', err);
            }
          }

          const finalSize = finalData.length;
          totalSize += finalSize;
          if (totalSize > MAX_UPLOAD_SIZE) {
            return reply.status(400).send({
              error: `Total upload size exceeds ${Math.round(MAX_UPLOAD_SIZE / (1024 * 1024))} MB limit (current: ${(totalSize / 1024 / 1024).toFixed(1)} MB)`,
            });
          }

          await storage.upload(storageKey, finalData, finalMime);

          await writeAuditLog({
            userId: request.userId,
            action: 'file_uploaded',
            resourceType: 'file',
            resourceId: undefined,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            metadata: {
              workId: request.params.workId,
              filename: sanitized,
              fileSize: finalSize,
              mimeType: finalMime,
            },
          });

          await updateUserUsage({
            userId: request.userId,
            storageDelta: finalSize,
            fileDelta: 1,
            uploadDelta: 1,
            timestamp: new Date().toISOString(),
          });
          await evaluateAbuseSignals({
            userId: request.userId,
            action: 'upload',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          });

          const [file] = await db
            .insert(files)
            .values({
              workId: Number(request.params.workId),
              userId: request.userId,
              filename,
              sanitizedFilename: sanitized,
              extension: ext,
              sizeBytes: finalSize,
              storageKey,
              contentType: finalMime,
            })
            .returning();

          uploadedFiles.push(file);
        }

        if (uploadedFiles.length === 0) {
          return reply.status(400).send({ error: 'No files were uploaded' });
        }

        // Update work timestamp
        await db
          .update(works)
          .set({ updatedAt: new Date().toISOString() })
          .where(eq(works.id, Number(request.params.workId)));

        return reply.status(201).send({ files: uploadedFiles, count: uploadedFiles.length });
      },
    );

    // List files for a work
    fastify.get<{ Params: { workId: string } }>(
      '/api/works/:workId/files',
      async (request, reply) => {
        const db = getDb();

        const [work] = await db
          .select({ id: works.id })
          .from(works)
          .where(and(eq(works.id, Number(request.params.workId)), eq(works.userId, request.userId)))
          .limit(1);

        if (!work) {
          return reply.status(404).send({ error: 'Work not found' });
        }

        const result = await db
          .select()
          .from(files)
          .where(eq(files.workId, Number(request.params.workId)))
          .orderBy(sql`${files.createdAt} DESC`);

        return { files: result };
      },
    );

    // Download a single file
    fastify.get<{ Params: { id: string } }>('/api/files/:id', async (request, reply) => {
      const db = getDb();
      const [file] = await db
        .select()
        .from(files)
        .where(and(eq(files.id, Number(request.params.id)), eq(files.userId, request.userId)))
        .limit(1);

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const { data, contentType } = await storage.download(file.storageKey);

      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${file.filename}"`)
        .header('Content-Length', data.length)
        .send(data);
    });

    // Preview a file (text-based only)
    fastify.get<{ Params: { id: string } }>('/api/files/:id/preview', async (request, reply) => {
      const db = getDb();
      const [file] = await db
        .select()
        .from(files)
        .where(and(eq(files.id, Number(request.params.id)), eq(files.userId, request.userId)))
        .limit(1);

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      if (!TEXT_EXTENSIONS.has(file.extension)) {
        return reply.status(400).send({
          error: 'Preview is only available for text-based files',
          downloadOnly: true,
        });
      }

      const { data } = await storage.download(file.storageKey);
      const content = data.toString('utf-8');

      return {
        file: {
          id: file.id,
          filename: file.filename,
          extension: file.extension,
          size_bytes: file.sizeBytes,
        },
        content,
        language: file.extension,
      };
    });

    // Delete a single file (soft delete)
    fastify.delete<{ Params: { id: string } }>('/api/files/:id', async (request, reply) => {
      if (await requireNotSuspended(request, reply)) return;

      const db = getDb();
      const [file] = await db
        .select()
        .from(files)
        .where(and(eq(files.id, Number(request.params.id)), eq(files.userId, request.userId)))
        .limit(1);

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.transaction(async (tx) => {
        await tx.insert(recycleBin).values({
          userId: request.userId,
          itemType: 'file',
          itemId: file.id,
          originalData: JSON.stringify({ file }),
          expiresAt,
        });

        await tx.delete(files).where(eq(files.id, file.id));
      });

      return { success: true, message: 'File moved to recycle bin' };
    });
  };
}
