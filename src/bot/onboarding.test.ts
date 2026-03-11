import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartAuthFlow, normalizeAuthInput } from './onboarding';

test('normalizeAuthInput ignores bot commands during auth flow', () => {
  assert.equal(normalizeAuthInput('/start'), null);
  assert.equal(normalizeAuthInput('   /help  '), null);
});

test('normalizeAuthInput trims and accepts regular auth values', () => {
  assert.equal(normalizeAuthInput(' 91026 '), '91026');
  assert.equal(normalizeAuthInput('my-2fa-password'), 'my-2fa-password');
});

test('canStartAuthFlow blocks re-entry while flow is active', () => {
  assert.equal(canStartAuthFlow(false), true);
  assert.equal(canStartAuthFlow(true), false);
});
