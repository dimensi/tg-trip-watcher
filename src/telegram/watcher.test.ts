import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramWatcher } from './watcher';

class FakeClient {
  public connected = true;
  public handlers: Array<{ cb: CallableFunction; event: unknown }> = [];
  public failOnAdd = false;

  public addEventHandler(cb: CallableFunction, event: unknown): void {
    if (this.failOnAdd) {
      throw new Error('addEventHandler failed');
    }
    this.handlers.push({ cb, event });
  }

  public removeEventHandler(cb: CallableFunction, event: unknown): void {
    this.handlers = this.handlers.filter((handler) => handler.cb !== cb || handler.event !== event);
  }

  public async connect(): Promise<void> {}
}

test('TelegramWatcher.reload replaces previous subscription with new channels', async () => {
  const client = new FakeClient();
  const watcher = new TelegramWatcher(client as never, async () => {});

  await watcher.start(['@one']);
  assert.equal(client.handlers.length, 1);

  await watcher.reload(['@two']);
  assert.equal(client.handlers.length, 1);
});

test('TelegramWatcher.stop removes active subscription', async () => {
  const client = new FakeClient();
  const watcher = new TelegramWatcher(client as never, async () => {});

  await watcher.start(['@one']);
  assert.equal(client.handlers.length, 1);

  watcher.stop();
  assert.equal(client.handlers.length, 0);
});

test('TelegramWatcher.reload keeps previous subscription if rebinding fails', async () => {
  const client = new FakeClient();
  const watcher = new TelegramWatcher(client as never, async () => {});

  await watcher.start(['@one']);
  assert.equal(client.handlers.length, 1);

  client.failOnAdd = true;
  await assert.rejects(async () => watcher.reload(['@two']), /addEventHandler failed/);

  assert.equal(client.handlers.length, 1);
});
