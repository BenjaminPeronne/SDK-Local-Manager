/** Délais des lectures de secours ; le flux SSE reste la source des changements en direct. */
// Flux connecté : il pousse l'état général et l'état système dès qu'ils changent, la relecture n'est qu'un filet.
const STREAM_SAFETY_NET_MS = 120000;

export function jobsRefreshInterval(streamConnected: boolean, hasRunningJobs: boolean) {
  return streamConnected ? 10000 : hasRunningJobs ? 1200 : 10000;
}

export function overviewRefreshInterval(streamConnected: boolean, hasRunningJobs: boolean) {
  if (streamConnected) return STREAM_SAFETY_NET_MS;
  return hasRunningJobs ? 15000 : 45000;
}

export function systemRefreshInterval(streamConnected: boolean, dockerPollInterval: number | undefined) {
  if (streamConnected) return STREAM_SAFETY_NET_MS;
  return Math.max(3, dockerPollInterval || 10) * 3000;
}
