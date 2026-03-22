import { TelegramClientParams } from 'telegram/client/telegramBaseClient';

type MtProxyConfig = NonNullable<TelegramClientParams['proxy']>;

const DIRECT_CLIENT_PARAMS: TelegramClientParams = {
  connectionRetries: 10,
  useWSS: true,
};

export const parseMtProxyUrl = (raw: string | undefined): MtProxyConfig | undefined => {
  if (!raw?.trim()) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MT_PROXY must be a valid tg://proxy URL');
  }

  if (url.protocol !== 'tg:' || url.hostname !== 'proxy') {
    throw new Error('MT_PROXY must use tg://proxy format');
  }

  const ip = url.searchParams.get('server');
  const portRaw = url.searchParams.get('port');
  const secret = url.searchParams.get('secret');
  const port = Number(portRaw);

  if (!ip || !portRaw || !secret || !Number.isInteger(port) || port <= 0) {
    throw new Error('MT_PROXY must include valid server, port and secret');
  }

  return {
    ip,
    port,
    secret,
    MTProxy: true,
  };
};

export const buildTelegramClientParams = (mtProxyUrl: string | undefined): TelegramClientParams => {
  const proxy = parseMtProxyUrl(mtProxyUrl);
  if (!proxy) {
    return DIRECT_CLIENT_PARAMS;
  }

  return {
    connectionRetries: 10,
    useWSS: false,
    proxy,
  };
};
