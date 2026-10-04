/**
 * StorageAdapter — abstraction over file storage backends.
 * Implementations: MockS3Adapter (dev), S3Adapter (production), GoogleDriveStorageAdapter (production).
 */
export interface StorageMetrics {
    /** Total storage capacity in bytes */
    totalBytes: number;
    /** Total storage used across the storage backend in bytes */
    usedBytes: number;
    /** Available vacant space remaining in bytes */
    vacantBytes: number;
    /** Space utilized specifically by this LabRepo instance in bytes */
    instanceUsedBytes: number;
    /** Computed storage quota allocated per user in bytes */
    allocatedPerUserBytes: number;
}
export interface StorageAdapter {
    /** Upload a file to storage */
    upload(key: string, data: Buffer, contentType: string): Promise<void>;
    /** Download a file from storage */
    download(key: string): Promise<{
        data: Buffer;
        contentType: string;
    }>;
    /** Delete a file from storage */
    delete(key: string): Promise<void>;
    /** Check if a file exists in storage */
    exists(key: string): Promise<boolean>;
    /** List all keys under a prefix */
    list(prefix: string): Promise<string[]>;
    /** Optional: get storage metrics and per-user dynamic allocation */
    getStorageMetrics?(userCount?: number): Promise<StorageMetrics>;
}
/**
 * Build a storage key for a file.
 * Format: {userId}/{sessionName}/{subjectName}/{workTitle}/{filename}
 */
export declare function buildStorageKey(userId: string, sessionName: string, subjectName: string, workTitle: string, filename: string): string;
