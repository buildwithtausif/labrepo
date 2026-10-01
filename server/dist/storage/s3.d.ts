import type { StorageAdapter } from './adapter.js';
export declare class S3Adapter implements StorageAdapter {
    private client;
    private bucket;
    constructor();
    initBucket(): Promise<void>;
    upload(key: string, data: Buffer, contentType: string): Promise<void>;
    download(key: string): Promise<{
        data: Buffer;
        contentType: string;
    }>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    list(prefix: string): Promise<string[]>;
}
