export const canStartWatcher = (watcherExists: boolean, startInProgress: boolean): boolean =>
  !watcherExists && !startInProgress;
