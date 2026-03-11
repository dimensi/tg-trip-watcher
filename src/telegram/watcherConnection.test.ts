import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldConnectClient } from './watcherConnection';

test('shouldConnectClient returns true when client is not connected', () => {
  assert.equal(shouldConnectClient(false), true);
  assert.equal(shouldConnectClient(undefined), true);
});

test('shouldConnectClient returns false when client is already connected', () => {
  assert.equal(shouldConnectClient(true), false);
});
