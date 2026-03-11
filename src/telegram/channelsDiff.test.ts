import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldReloadChannels } from './channelsDiff';

test('shouldReloadChannels returns false when lists are equal', () => {
  assert.equal(shouldReloadChannels(['@a', '@b'], ['@a', '@b']), false);
});

test('shouldReloadChannels returns true when lengths differ', () => {
  assert.equal(shouldReloadChannels(['@a'], ['@a', '@b']), true);
});

test('shouldReloadChannels returns true when same length but values differ', () => {
  assert.equal(shouldReloadChannels(['@a', '@b'], ['@a', '@c']), true);
});
