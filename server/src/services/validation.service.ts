export interface ValidationResult {
  valid: boolean;
  sanitizedFilename?: string;
  extension?: string;
  contentType?: string;
  reason?: string;
}

export interface ValidationInput {
  filename: string;
  size: number;
  contentType?: string;
  allowedExtensions: Set<string>;
  maxBytes: number;
}

const DEFAULT_TEXT_CONTENT_TYPE = 'text/plain';

export function sanitizeFilename(filename: string): string {
  const baseName = filename
    .replace(/[\\/]+/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() ?? filename;

  const normalized = baseName
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .replace(/^\.+/, '_');

  return normalized || 'file';
}

export function getExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) {
    return '';
  }
  return parts[parts.length - 1].toLowerCase();
}

export function validateUploadCandidate(input: ValidationInput): ValidationResult {
  const { filename, size, contentType, allowedExtensions, maxBytes } = input;

  if (!filename || filename.trim().length === 0) {
    return { valid: false, reason: 'Filename is required.' };
  }

  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return { valid: false, reason: 'Path traversal is not allowed in filenames.' };
  }

  const sanitizedFilename = sanitizeFilename(filename);
  const extension = getExtension(sanitizedFilename);

  if (!allowedExtensions.has(extension)) {
    return {
      valid: false,
      sanitizedFilename,
      extension,
      reason: `Unsupported file extension: .${extension || 'unknown'}`,
    };
  }

  if (size > maxBytes) {
    return {
      valid: false,
      sanitizedFilename,
      extension,
      reason: `File is larger than the allowed size of ${maxBytes} bytes.`,
    };
  }

  const normalizedContentType = contentType?.split(';')[0].trim() || DEFAULT_TEXT_CONTENT_TYPE;

  return {
    valid: true,
    sanitizedFilename,
    extension,
    contentType: normalizedContentType,
  };
}
