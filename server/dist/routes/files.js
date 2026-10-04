import { Router } from 'express';
import { getDb } from '../db/runtime.js';
import { files, works, subjects, academicSessions, recycleBin } from '../db/schema.js';
import { buildStorageKey } from '../storage/adapter.js';
import { validateUploadCandidate } from '../services/validation.service.js';
import { writeAuditLog } from '../services/audit.service.js';
import { updateUserUsage } from '../services/usage.service.js';
import { evaluateAbuseSignals } from '../services/moderation.service.js';
import { getSecurityConfig, getDynamicSecurityConfig } from '../services/config.service.js';
import { rateLimiter } from '../services/rate-limit.service.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireNotSuspendedMiddleware } from '../auth/suspension.js';
import sharp from 'sharp';
import { upload } from '../middlewares/upload.js';
const securityConfig = getSecurityConfig();
// Text-based extensions that support preview
const TEXT_EXTENSIONS = new Set([
    'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'cs', 'go',
    'rs', 'swift', 'php', 'rb', 'r', 'scala', 'sql', 'html', 'css', 'scss',
    'json', 'yaml', 'yml', 'xml', 'md', 'txt', 'csv', 'ipynb',
    'env', 'sh', 'bat', 'ps1', 'toml', 'ini', 'cfg', 'conf', 'log', 'dockerfile', 'tex', 'rtf',
]);
function getExtension(filename) {
    const parts = filename.split('.');
    if (parts.length < 2)
        return '';
    return parts[parts.length - 1].toLowerCase();
}
function getContentType(ext) {
    const types = {
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
        'mp4': 'video/mp4', 'webm': 'video/webm', 'ogg': 'video/ogg', 'mp3': 'audio/mpeg',
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
export function createFileRoutes(resolveStorage) {
    const router = Router();
    // Upload files to a work
    router.post('/api/works/:workId/files', requireNotSuspendedMiddleware, upload.array('files', 20), async (req, res) => {
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
            .where(and(eq(works.id, Number(req.params.workId)), eq(works.userId, req.userId)))
            .limit(1);
        if (!work) {
            res.status(404).json({ error: 'Work not found' });
            return;
        }
        // Apply rate limit
        const rateResult = rateLimiter.check(`upload:${req.userId}`, { limit: securityConfig.uploadRateLimit, windowMs: 60 * 1000 });
        if (!rateResult.allowed) {
            res.status(429).json({ error: 'Too many uploads per minute. Please slow down.' });
            return;
        }
        const filesArray = Array.isArray(req.files) ? req.files : [];
        const uploadedFiles = [];
        let totalSize = 0;
        for (const part of filesArray) {
            const filename = part.originalname;
            if (!filename)
                continue;
            const data = part.buffer;
            // Fetch dynamic security config
            const dynamicConfig = await getDynamicSecurityConfig(db, req.userId);
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
                res.status(400).json({
                    error: validation.reason,
                    allowed: Array.from(ALLOWED_EXTENSIONS),
                });
                return;
            }
            const ext = validation.extension ?? getExtension(filename);
            const sanitized = validation.sanitizedFilename ?? filename;
            const storageKey = buildStorageKey(req.userId, work.session_name, work.subject_name, work.title, sanitized);
            const contentType = validation.contentType ?? getContentType(ext);
            let finalData = data;
            let finalMime = contentType;
            // Apply intelligent image compression (skip SVG and non-images)
            if (contentType.startsWith('image/') && contentType !== 'image/svg+xml') {
                try {
                    const image = sharp(data).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true });
                    if (contentType === 'image/jpeg' || contentType === 'image/jpg') {
                        finalData = await image.jpeg({ quality: 82 }).toBuffer();
                    }
                    else if (contentType === 'image/png') {
                        finalData = await image.png({ quality: 82, compressionLevel: 9 }).toBuffer();
                    }
                    else if (contentType === 'image/webp') {
                        finalData = await image.webp({ quality: 82 }).toBuffer();
                    }
                }
                catch (err) {
                    console.warn('Image compression failed, using original buffer', err);
                }
            }
            const finalSize = finalData.length;
            totalSize += finalSize;
            if (totalSize > MAX_UPLOAD_SIZE) {
                res.status(400).json({
                    error: `Total upload size exceeds ${Math.round(MAX_UPLOAD_SIZE / (1024 * 1024))} MB limit (current: ${(totalSize / 1024 / 1024).toFixed(1)} MB)`,
                });
                return;
            }
            const storage = await resolveStorage(req.userId);
            await storage.upload(storageKey, finalData, finalMime);
            await writeAuditLog({
                userId: req.userId,
                action: 'file_uploaded',
                resourceType: 'file',
                resourceId: undefined,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                metadata: {
                    workId: req.params.workId,
                    filename: sanitized,
                    fileSize: finalSize,
                    mimeType: finalMime,
                },
            });
            await updateUserUsage({
                userId: req.userId,
                storageDelta: finalSize,
                fileDelta: 1,
                uploadDelta: 1,
                timestamp: new Date().toISOString(),
            });
            await evaluateAbuseSignals({
                userId: req.userId,
                action: 'upload',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
            });
            const [file] = await db
                .insert(files)
                .values({
                workId: Number(req.params.workId),
                userId: req.userId,
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
            res.status(400).json({ error: 'No files were uploaded' });
            return;
        }
        // Update work timestamp
        await db
            .update(works)
            .set({ updatedAt: new Date().toISOString() })
            .where(eq(works.id, Number(req.params.workId)));
        res.status(201).json({ files: uploadedFiles, count: uploadedFiles.length });
    });
    // List files for a work
    router.get('/api/works/:workId/files', async (req, res) => {
        const db = getDb();
        const [work] = await db
            .select({ id: works.id })
            .from(works)
            .where(and(eq(works.id, Number(req.params.workId)), eq(works.userId, req.userId)))
            .limit(1);
        if (!work) {
            res.status(404).json({ error: 'Work not found' });
            return;
        }
        const result = await db
            .select()
            .from(files)
            .where(eq(files.workId, Number(req.params.workId)))
            .orderBy(sql `${files.createdAt} DESC`);
        res.json({ files: result });
    });
    // Download a single file
    router.get('/api/files/:id', async (req, res) => {
        const db = getDb();
        const [file] = await db
            .select()
            .from(files)
            .where(and(eq(files.id, Number(req.params.id)), eq(files.userId, req.userId)))
            .limit(1);
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        const storage = await resolveStorage(req.userId);
        const { data, contentType } = await storage.download(file.storageKey);
        res.set({
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            'Content-Length': data.length
        });
        res.send(data);
    });
    // Stream a single video file
    router.get('/api/files/:id/stream', async (req, res) => {
        const db = getDb();
        const [file] = await db
            .select()
            .from(files)
            .where(and(eq(files.id, Number(req.params.id)), eq(files.userId, req.userId)))
            .limit(1);
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        const storage = await resolveStorage(req.userId);
        const { data, contentType } = await storage.download(file.storageKey);
        const total = data.length;
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
            const chunkSize = (end - start) + 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
            });
            res.end(data.subarray(start, end + 1));
        }
        else {
            res.writeHead(200, {
                'Content-Length': total,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
            });
            res.end(data);
        }
    });
    // Preview a file (text-based only)
    router.get('/api/files/:id/preview', async (req, res) => {
        const db = getDb();
        const [file] = await db
            .select()
            .from(files)
            .where(and(eq(files.id, Number(req.params.id)), eq(files.userId, req.userId)))
            .limit(1);
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        if (!TEXT_EXTENSIONS.has(file.extension)) {
            res.status(400).json({
                error: 'Preview is only available for text-based files',
                downloadOnly: true,
            });
            return;
        }
        const storage = await resolveStorage(req.userId);
        const { data } = await storage.download(file.storageKey);
        const content = data.toString('utf-8');
        res.json({
            file: {
                id: file.id,
                filename: file.filename,
                extension: file.extension,
                size_bytes: file.sizeBytes,
            },
            content,
            language: file.extension,
        });
    });
    // Delete a single file (soft delete)
    router.delete('/api/files/:id', requireNotSuspendedMiddleware, async (req, res) => {
        const db = getDb();
        const [file] = await db
            .select()
            .from(files)
            .where(and(eq(files.id, Number(req.params.id)), eq(files.userId, req.userId)))
            .limit(1);
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await db.transaction(async (tx) => {
            await tx.insert(recycleBin).values({
                userId: req.userId,
                itemType: 'file',
                itemId: file.id,
                originalData: JSON.stringify({ file }),
                expiresAt,
            });
            await tx.delete(files).where(eq(files.id, file.id));
        });
        res.json({ success: true, message: 'File moved to recycle bin' });
    });
    return router;
}
