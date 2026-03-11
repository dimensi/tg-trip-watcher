import test from 'node:test';
import assert from 'node:assert/strict';
import { createPollingOptions, isStartCommand, shouldAllowUpdateByChat } from './index';

test('isStartCommand detects /start and /start@bot forms', () => {
  assert.equal(isStartCommand('/start'), true);
  assert.equal(isStartCommand('/start@trip_adviser_bot'), true);
  assert.equal(isStartCommand('/start hello'), true);
  assert.equal(isStartCommand('/status'), false);
  assert.equal(isStartCommand('hello'), false);
});

test('shouldAllowUpdateByChat allows mismatched chat only for /start', () => {
  assert.equal(shouldAllowUpdateByChat(111, 222, '/start'), true);
  assert.equal(shouldAllowUpdateByChat(111, 222, '/start@trip_adviser_bot'), true);
  assert.equal(shouldAllowUpdateByChat(111, 222, '/status'), false);
});

test('shouldAllowUpdateByChat allows matching or unbound chats', () => {
  assert.equal(shouldAllowUpdateByChat(null, 222, '/status'), true);
  assert.equal(shouldAllowUpdateByChat(222, 222, '/status'), true);
});

test('createPollingOptions enables dropping pending updates', () => {
  const controller = new AbortController();
  const options = createPollingOptions(controller.signal);
  assert.ok(options);
  assert.equal(options.drop_pending_updates, true);
});
