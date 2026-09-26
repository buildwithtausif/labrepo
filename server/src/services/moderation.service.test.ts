import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../db/runtime.js';
import { evaluateAbuseSignals } from './moderation.service.js';

test('evaluateAbuseSignals returns false for normal activity', async () => {
  await initDatabase();

  const result = await evaluateAbuseSignals({
    userId: 'moderation-test-user',
    action: 'upload',
  });

  assert.equal(result.flagged, false);
});
