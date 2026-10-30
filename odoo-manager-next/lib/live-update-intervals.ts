/** Délais des lectures de secours ; le flux SSE reste la source des changements en direct. */
export function jobsRefreshInterval(streamConnected: boolean, hasRunningJobs: boolean) {
  return streamConnected ? 10000 : hasRunningJobs ? 1200 : 10000;
}

export function overviewRefreshInterval(hasRunningJobs: boolean) {
  return hasRunningJobs ? 15000 : 45000;
}

export function systemRefreshInterval(dockerPollInterval: number | undefined) {
  return Math.max(3, dockerPollInterval || 10) * 3000;
}
