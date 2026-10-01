/**
 * Build a storage key for a file.
 * Format: {userId}/{sessionName}/{subjectName}/{workTitle}/{filename}
 */
export function buildStorageKey(userId, sessionName, subjectName, workTitle, filename) {
    return [userId, sessionName, subjectName, workTitle, filename]
        .map(sanitizePathSegment)
        .join('/');
}
/**
 * Sanitize a path segment for use in storage keys.
 * Removes dangerous characters while keeping it human-readable.
 */
function sanitizePathSegment(segment) {
    return segment
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\.{2,}/g, '_')
        .trim()
        .replace(/^\.+/, '_');
}
