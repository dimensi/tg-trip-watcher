export const shouldReloadChannels = (previous: string[], next: string[]): boolean => {
  if (previous.length !== next.length) return true;
  return previous.some((channel, index) => channel !== next[index]);
};
