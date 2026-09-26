export interface RateLimitConfig {
    limit: number;
    windowMs: number;
}
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}
export declare function createRateLimiter(): {
    check(key: string, config: RateLimitConfig): RateLimitResult;
};
export declare const rateLimiter: {
    check(key: string, config: RateLimitConfig): RateLimitResult;
};
