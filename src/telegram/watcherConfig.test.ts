import test from 'node:test';
import assert from 'node:assert/strict';
import { watcherConfigErrorForChannels } from './watcherConfig';

test('watcherConfigErrorForChannels returns error when channels are empty', () => {
  assert.equal(
    watcherConfigErrorForChannels([]),
    'No channels configured. Use /addchannel to add channels.'
  );
});

test('watcherConfigErrorForChannels returns null for non-empty channels', () => {
  assert.equal(watcherConfigErrorForChannels(['@deals']), null);
});
