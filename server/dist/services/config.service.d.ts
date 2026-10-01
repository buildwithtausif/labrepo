export interface SecurityConfig {
    maxUploadBytes: number;
    maxStoragePerUserBytes: number;
    loginRateLimit: number;
    uploadRateLimit: number;
    maxRepositories: number;
    allowedExtensions: string[];
}
export declare function getSecurityConfig(): SecurityConfig;
export declare function getDynamicSecurityConfig(db: any, userId?: string): Promise<SecurityConfig>;
