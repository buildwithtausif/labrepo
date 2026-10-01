import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rate-limit.service.js';
test('rate limiter allows requests until the configured limit is hit', () => {
    const limiter = createRateLimiter();
    const config = { limit: 2, windowMs: 60_000 };
    assert.equal(limiter.check('user-1', config).allowed, true);
    assert.equal(limiter.check('user-1', config).allowed, true);
    assert.equal(limiter.check('user-1', config).allowed, false);
});
test('rate limiter resets once the window elapses', () => {
    const limiter = createRateLimiter();
    const config = { limit: 1, windowMs: 50 };
    assert.equal(limiter.check('user-2', config).allowed, true);
    assert.equal(limiter.check('user-2', config).allowed, false);
    return new Promise((resolve) => {
        setTimeout(() => {
            assert.equal(limiter.check('user-2', config).allowed, true);
            resolve();
        }, 60);
    });
});
