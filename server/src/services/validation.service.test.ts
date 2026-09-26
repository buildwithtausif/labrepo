import test from 'node:test';
import assert from 'node:assert/strict';
import { getExtension, sanitizeFilename, validateUploadCandidate } from './validation.service.js';

test('sanitizeFilename removes dangerous path separators and trim issues', () => {
  assert.equal(sanitizeFilename('../../../../secret.txt'), 'secret.txt');
  assert.equal(sanitizeFilename('report final (1).txt'), 'report final (1).txt');
});

test('getExtension returns lowercase extension', () => {
  assert.equal(getExtension('My.File.PY'), 'py');
});

test('validateUploadCandidate rejects unsupported or oversized files', () => {
  const ok = validateUploadCandidate({
    filename: 'notes.py',
    size: 1024,
    contentType: 'text/x-python',
    allowedExtensions: new Set(['py']),
    maxBytes: 2048,
  });

  assert.equal(ok.valid, true);

  const badExt = validateUploadCandidate({
    filename: 'notes.exe',
    size: 1024,
    contentType: 'application/x-msdownload',
    allowedExtensions: new Set(['py']),
    maxBytes: 2048,
  });

  assert.equal(badExt.valid, false);
  assert.match(badExt.reason ?? '', /Unsupported/);

  const tooBig = validateUploadCandidate({
    filename: 'notes.py',
    size: 4096,
    contentType: 'text/x-python',
    allowedExtensions: new Set(['py']),
    maxBytes: 2048,
  });

  assert.equal(tooBig.valid, false);
  assert.match(tooBig.reason ?? '', /larger/i);
});
