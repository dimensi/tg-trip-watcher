export const watcherConfigErrorForChannels = (channels: string[]): string | null => {
  if (channels.length === 0) {
    return 'No channels configured. Use /addchannel to add channels.';
  }
  return null;
};
