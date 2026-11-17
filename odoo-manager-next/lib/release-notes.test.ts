import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, formatReleaseDate, shouldAnnounceReleaseNotes } from "./release-notes.ts";

test("versions compare as numbers", () => {
  assert.ok(compareVersions("0.9.0", "0.10.0") < 0);
  assert.ok(compareVersions("1.0.0", "0.99.9") > 0);
  assert.equal(compareVersions("0.51.0", "0.51.0"), 0);
});

test("release notes open once, right after an update", () => {
  assert.equal(shouldAnnounceReleaseNotes(null, "0.52.0"), false);
  assert.equal(shouldAnnounceReleaseNotes("0.51.0", "0.52.0"), true);
  assert.equal(shouldAnnounceReleaseNotes("0.52.0", "0.52.0"), false);
  assert.equal(shouldAnnounceReleaseNotes("0.53.0", "0.52.0"), false);
});

test("release dates read in French", () => {
  assert.equal(formatReleaseDate("2026-11-17"), "17 novembre 2026");
  assert.equal(formatReleaseDate("bientôt"), "bientôt");
});
