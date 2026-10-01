import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonAt, seasonOverride } from "./seasonal.ts";

test("christmas decorations run from the first to the thirtieth of December", () => {
  assert.equal(seasonAt(new Date(2026, 11, 1, 0, 0)), "christmas");
  assert.equal(seasonAt(new Date(2026, 11, 25, 12, 0)), "christmas");
  assert.equal(seasonAt(new Date(2026, 11, 30, 23, 59)), "christmas");
});

test("no decoration outside the season", () => {
  assert.equal(seasonAt(new Date(2026, 10, 30, 23, 59)), null);
  // Le 31 décembre est laissé au Nouvel An.
  assert.equal(seasonAt(new Date(2026, 11, 31, 0, 0)), null);
  assert.equal(seasonAt(new Date(2027, 0, 1)), null);
  assert.equal(seasonAt(new Date(2026, 6, 14)), null);
});

test("the address can force or turn off a season", () => {
  assert.equal(seasonOverride(""), undefined);
  assert.equal(seasonOverride("?project=demo"), undefined);
  assert.equal(seasonOverride("?season=christmas"), "christmas");
  assert.equal(seasonOverride("?season=none"), null);
  assert.equal(seasonOverride("?season=unknown"), null);
});
