// Mesure la comparaison actuelle avec des données synthétiques, sans React ni navigateur.
const { performance } = require("node:perf_hooks");

function run(count) {
  const project = (i) => ({
    name: `project-${i}`, odoo_status: "running", postgres_status: "running", odoo_version: "18.0",
    url: `http://dev.project-${i}.localhost/`, databases: Array.from({ length: 10 }, (_, n) => `database_${n}`),
    database_retention: {},
  });
  const previous = { workspace: "/workspace", docker_ok: true, docker_message: "ready", projects: Array.from({ length: count }, (_, i) => project(i)) };
  const next = structuredClone(previous);
  const timings = [];
  for (let i = 0; i < 5000; i++) {
    const start = performance.now();
    if (JSON.stringify(previous) !== JSON.stringify(next)) throw new Error("different payloads");
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return { projects: count, databases_per_project: 10, payload_bytes: Buffer.byteLength(JSON.stringify(previous)), p50_ms: timings[2499], p95_ms: timings[4749] };
}
console.log(JSON.stringify([1, 10, 50].map(run), null, 2));
