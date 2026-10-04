import test from 'node:test';
import assert from 'node:assert/strict';
import { getSecurityConfig } from './config.service.js';

test('getSecurityConfig respects environment overrides', () => {
  const previous = {
    MAX_UPLOAD_SIZE: process.env.MAX_UPLOAD_SIZE,
    UPLOADS_PER_MINUTE: process.env.UPLOADS_PER_MINUTE,
    MAX_REPOSITORIES: process.env.MAX_REPOSITORIES,
    ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES,
  };

  process.env.MAX_UPLOAD_SIZE = '1234';
  process.env.LOGIN_RATE_LIMIT = '7';
  process.env.UPLOADS_PER_MINUTE = '8';
  process.env.MAX_REPOSITORIES = '9';
  process.env.ALLOWED_FILE_TYPES = 'py,txt,md';

  const config = getSecurityConfig();
  assert.equal(config.maxUploadBytes, 1234);
  assert.equal(config.loginRateLimit, 7);
  assert.equal(config.uploadRateLimit, 8);
  assert.equal(config.maxRepositories, 9);
  
  // Test append behavior
  assert.ok(config.allowedExtensions.includes('py'));
  assert.ok(config.allowedExtensions.includes('txt'));
  assert.ok(config.allowedExtensions.includes('md'));
  
  // Also test REPLACE_FILE_TYPES behavior
  process.env.REPLACE_FILE_TYPES = 'onlythis';
  const configReplaced = getSecurityConfig();
  assert.deepEqual(configReplaced.allowedExtensions, ['onlythis']);
  delete process.env.REPLACE_FILE_TYPES;

  Object.assign(process.env, previous);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
