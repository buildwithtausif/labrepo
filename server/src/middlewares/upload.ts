import multer from 'multer';
import { getSecurityConfig } from '../services/config.service.js';

const securityConfig = getSecurityConfig();

// Using memory storage because the backend streams/buffers uploads to S3/Gdrive adapters
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: securityConfig.maxUploadBytes,
    files: 20, // Align with previous fastify multipart limit
  },
});
