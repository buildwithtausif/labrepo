import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../db/runtime.js';
import { updateUserUsage } from './usage.service.js';

test('updateUserUsage writes counters without throwing', async () => {
  await initDatabase();

  await assert.doesNotReject(() => updateUserUsage({
    userId: 'usage-test-user',
    storageDelta: 2048,
    fileDelta: 1,
    uploadDelta: 1,
    downloadDelta: 1,
    loginDelta: 1,
    repositoryDelta: 1,
    timestamp: '2026-08-06T10:00:00.000Z',
  }));
});
