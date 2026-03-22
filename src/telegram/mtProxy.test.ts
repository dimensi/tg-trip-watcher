import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTelegramClientParams, parseMtProxyUrl } from './mtProxy';

test('parseMtProxyUrl returns undefined when MTProxy url is missing', () => {
  assert.equal(parseMtProxyUrl(undefined), undefined);
  assert.equal(parseMtProxyUrl('   '), undefined);
});

test('parseMtProxyUrl parses tg://proxy url into gramjs MTProxy config', () => {
  assert.deepEqual(
    parseMtProxyUrl('tg://proxy?server=10.10.0.1&port=443&secret=0123456789abcdef0123456789abcdef'),
    {
      ip: '10.10.0.1',
      port: 443,
      secret: '0123456789abcdef0123456789abcdef',
      MTProxy: true,
    }
  );
});

test('parseMtProxyUrl rejects invalid MTProxy url', () => {
  assert.throws(
    () => parseMtProxyUrl('tg://proxy?server=10.10.0.1&port=abc&secret=test'),
    /MT_PROXY/
  );
});

test('buildTelegramClientParams prefers direct connection when no proxy is configured', () => {
  assert.deepEqual(buildTelegramClientParams(undefined), {
    connectionRetries: 10,
    useWSS: true,
  });
});

test('buildTelegramClientParams disables WSS and enables gramjs proxy config when MTProxy is configured', () => {
  assert.deepEqual(
    buildTelegramClientParams('tg://proxy?server=10.10.0.1&port=443&secret=0123456789abcdef0123456789abcdef'),
    {
      connectionRetries: 10,
      useWSS: false,
      proxy: {
        ip: '10.10.0.1',
        port: 443,
        secret: '0123456789abcdef0123456789abcdef',
        MTProxy: true,
      },
    }
  );
});
