import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForJobStatus } from "./job-wait.ts";

test("a cancelled action stops the wait immediately", async () => {
  let delays = 0;
  await assert.rejects(
    waitForJobStatus(
      1,
      async () => [{ id: 1, status: "cancelled", lines: [] }],
      async () => {
        delays++;
      },
      1000,
    ),
    /arrêtée/,
  );
  assert.equal(delays, 0);
});

test("a running action is followed until completion", async () => {
  let reads = 0;
  const done = { id: 1, status: "done", lines: [] };
  const result = await waitForJobStatus(
    1,
    async () => [++reads === 1 ? { ...done, status: "running" } : done],
    async () => {},
    1000,
  );
  assert.equal(result, done);
  assert.equal(reads, 2);
});

test("a failed action reports its error", async () => {
  await assert.rejects(
    waitForJobStatus(
      1,
      async () => [{ id: 1, status: "error", lines: ["échec"] }],
      async () => {},
      1000,
    ),
    /échec/,
  );
});
