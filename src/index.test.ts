import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartWatcher } from './telegram/watcherStartGuard';

test('canStartWatcher only allows first start', () => {
  assert.equal(canStartWatcher(false, false), true);
  assert.equal(canStartWatcher(true, false), false);
  assert.equal(canStartWatcher(false, true), false);
  assert.equal(canStartWatcher(true, true), false);
});
