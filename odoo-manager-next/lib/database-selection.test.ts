import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseToKeep } from "./database-selection.ts";

const bases = ["PROTEX_02092026", "PROTEX_15092026", "PROTEX_20812", "postgres"];

test("the chosen database survives every refresh that still lists it", () => {
  assert.equal(databaseToKeep(bases, "PROTEX_15092026", "PROTEX_15092026"), "PROTEX_15092026");
});

test("an empty list while PostgreSQL is slow keeps the choice instead of dropping it", () => {
  // Cas signalé : une sonde vide suivie d'une liste complète ramenait à la première base.
  const duringSlowProbe = databaseToKeep([], "PROTEX_15092026", "PROTEX_15092026");
  assert.equal(duringSlowProbe, "PROTEX_15092026");
  assert.equal(databaseToKeep(bases, duringSlowProbe, "PROTEX_15092026"), "PROTEX_15092026");
  assert.equal(databaseToKeep(undefined, "PROTEX_15092026"), "PROTEX_15092026");
});

test("coming back to a project restores the database chosen earlier in the session", () => {
  assert.equal(databaseToKeep(bases, "", "PROTEX_20812"), "PROTEX_20812");
});

test("a deleted database falls back to the first one, never to a name that no longer exists", () => {
  const afterDeletion = ["PROTEX_02092026", "PROTEX_20812"];
  assert.equal(databaseToKeep(afterDeletion, "PROTEX_15092026", "PROTEX_15092026"), "PROTEX_02092026");
});

test("the PostgreSQL maintenance database is never kept as a working database", () => {
  assert.equal(databaseToKeep(bases, "postgres", undefined), "PROTEX_02092026");
  assert.equal(databaseToKeep(["postgres"], "PROTEX_15092026"), "PROTEX_15092026");
});
