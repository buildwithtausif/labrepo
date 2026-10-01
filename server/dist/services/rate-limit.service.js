export function createRateLimiter() {
    const buckets = new Map();
    return {
        check(key, config) {
            const now = Date.now();
            const existing = buckets.get(key);
            if (!existing || existing.resetAt <= now) {
                const resetAt = now + config.windowMs;
                buckets.set(key, { count: 1, resetAt });
                return { allowed: true, remaining: config.limit - 1, resetAt };
            }
            if (existing.count >= config.limit) {
                return { allowed: false, remaining: 0, resetAt: existing.resetAt };
            }
            existing.count += 1;
            return { allowed: true, remaining: config.limit - existing.count, resetAt: existing.resetAt };
        },
    };
}
export const rateLimiter = createRateLimiter();
