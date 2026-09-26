interface UsageUpdateOptions {
    userId: string;
    storageDelta?: number;
    fileDelta?: number;
    repositoryDelta?: number;
    uploadDelta?: number;
    downloadDelta?: number;
    loginDelta?: number;
    timestamp?: string;
}
export declare function updateUserUsage(options: UsageUpdateOptions): Promise<void>;
export {};
