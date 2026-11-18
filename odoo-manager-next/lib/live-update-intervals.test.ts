import assert from "node:assert/strict";
import { test } from "node:test";
import { jobsRefreshInterval, overviewRefreshInterval, systemRefreshInterval } from "./live-update-intervals.ts";

test("fallback intervals preserve the existing connected and disconnected behavior", () => {
  assert.equal(jobsRefreshInterval(true, true), 10000);
  assert.equal(jobsRefreshInterval(false, true), 1200);
  assert.equal(jobsRefreshInterval(false, false), 10000);
  assert.equal(overviewRefreshInterval(false, true), 15000);
  assert.equal(overviewRefreshInterval(false, false), 45000);
  assert.equal(systemRefreshInterval(false, undefined), 30000);
  assert.equal(systemRefreshInterval(false, 1), 9000);
});

test("a connected stream spaces the overview and system safety-net reads", () => {
  assert.equal(overviewRefreshInterval(true, true), 120000);
  assert.equal(systemRefreshInterval(true, 1), 120000);
});
