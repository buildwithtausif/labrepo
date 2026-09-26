import type { StorageAdapter } from './adapter.js';
/**
 * MockS3Adapter — emulates S3 using the local filesystem.
 * Files are stored under server/data/storage/{key}.
 * Used during development with fake AWS credentials.
 */
export declare class MockS3Adapter implements StorageAdapter {
    private basePath;
    constructor(basePath?: string);
    private resolvePath;
    upload(key: string, data: Buffer, _contentType: string): Promise<void>;
    download(key: string): Promise<{
        data: Buffer;
        contentType: string;
    }>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    list(prefix: string): Promise<string[]>;
}
