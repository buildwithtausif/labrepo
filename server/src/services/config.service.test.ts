import test from 'node:test';
import assert from 'node:assert/strict';
import { getSecurityConfig } from './config.service.js';

test('getSecurityConfig respects environment overrides', () => {
  const previous = {
    MAX_UPLOAD_SIZE: process.env.MAX_UPLOAD_SIZE,
    MAX_STORAGE_PER_USER: process.env.MAX_STORAGE_PER_USER,
    LOGIN_RATE_LIMIT: process.env.LOGIN_RATE_LIMIT,
    UPLOADS_PER_MINUTE: process.env.UPLOADS_PER_MINUTE,
    MAX_REPOSITORIES: process.env.MAX_REPOSITORIES,
    ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES,
  };

  process.env.MAX_UPLOAD_SIZE = '1234';
  process.env.MAX_STORAGE_PER_USER = '4321';
  process.env.LOGIN_RATE_LIMIT = '7';
  process.env.UPLOADS_PER_MINUTE = '8';
  process.env.MAX_REPOSITORIES = '9';
  process.env.ALLOWED_FILE_TYPES = 'py,txt,md';

  const config = getSecurityConfig();
  assert.equal(config.maxUploadBytes, 1234);
  assert.equal(config.maxStoragePerUserBytes, 4321);
  assert.equal(config.loginRateLimit, 7);
  assert.equal(config.uploadRateLimit, 8);
  assert.equal(config.maxRepositories, 9);
  assert.deepEqual(config.allowedExtensions, ['py', 'txt', 'md']);

  Object.assign(process.env, previous);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
