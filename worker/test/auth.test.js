import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized } from '../src/auth.js';

test('accepts a valid Bearer token with one or more spaces', () => {
  assert.equal(isAuthorized('Bearer secret-value', 'secret-value'), true);
  assert.equal(isAuthorized('bEaReR   secret-value', 'secret-value'), true);
});

test('rejects a missing or malformed authorization header', () => {
  assert.equal(isAuthorized(undefined, 'secret-value'), false);
  assert.equal(isAuthorized('', 'secret-value'), false);
  assert.equal(isAuthorized('secret-value', 'secret-value'), false);
});

test('rejects a wrong token and an unset server key', () => {
  assert.equal(isAuthorized('Bearer wrong', 'secret-value'), false);
  assert.equal(isAuthorized('Bearer secret-value', ''), false);
});
