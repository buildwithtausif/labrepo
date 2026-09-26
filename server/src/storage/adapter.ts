/**
 * StorageAdapter — abstraction over file storage backends.
 * Implementations: MockS3Adapter (dev), S3Adapter (production).
 */
export interface StorageAdapter {
  /** Upload a file to storage */
  upload(key: string, data: Buffer, contentType: string): Promise<void>;

  /** Download a file from storage */
  download(key: string): Promise<{ data: Buffer; contentType: string }>;

  /** Delete a file from storage */
  delete(key: string): Promise<void>;

  /** Check if a file exists in storage */
  exists(key: string): Promise<boolean>;

  /** List all keys under a prefix */
  list(prefix: string): Promise<string[]>;
}

/**
 * Build a storage key for a file.
 * Format: {userId}/{sessionName}/{subjectName}/{workTitle}/{filename}
 */
export function buildStorageKey(
  userId: string,
  sessionName: string,
  subjectName: string,
  workTitle: string,
  filename: string
): string {
  return [userId, sessionName, subjectName, workTitle, filename]
    .map(sanitizePathSegment)
    .join('/');
}

/**
 * Sanitize a path segment for use in storage keys.
 * Removes dangerous characters while keeping it human-readable.
 */
function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.{2,}/g, '_')
    .trim()
    .replace(/^\.+/, '_');
}
