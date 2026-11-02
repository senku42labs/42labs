import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoneNumber } from '../src/phone.js';

test('accepts an international phone number containing digits only', () => {
  assert.equal(normalizePhoneNumber('263771234567'), '263771234567');
});
test('trims surrounding whitespace', () => {
  assert.equal(normalizePhoneNumber(' 447911123456 '), '447911123456');
});
test('rejects numbers without a country code length', () => {
  assert.throws(() => normalizePhoneNumber('1234567'), /8–15 digits/);
});
test('rejects formatted numbers instead of silently changing them', () => {
  assert.throws(() => normalizePhoneNumber('+263 771 234 567'), /8–15 digits/);
});
test('rejects non-string input', () => {
  assert.throws(() => normalizePhoneNumber(263771234567), /must be a string/);
});
