/** Attend une action sans confondre son annulation avec un démarrage encore en cours. */
export async function waitForJobStatus<T extends { id: number; status: string; lines: string[] }>(
  jobId: number,
  readJobs: () => Promise<T[]>,
  delay: (milliseconds: number) => Promise<void>,
  timeoutMilliseconds: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const current = (await readJobs()).find((job) => job.id === jobId);
    if (!current) throw new Error("L'action est introuvable dans l'historique.");
    if (current.status === "done") return current;
    if (current.status === "cancelled") throw new Error("L'action a été arrêtée.");
    if (current.status === "error") {
      throw new Error(current.lines.filter(Boolean).at(-1) || "L'action a échoué.");
    }
    await delay(800);
  }
  throw new Error("L'action prend trop de temps. Consulte son journal.");
}
