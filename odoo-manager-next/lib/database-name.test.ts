import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseNameError } from "./database-name.ts";

test("validates names using the backend byte and path rules and known databases", () => {
  assert.equal(databaseNameError("Client recette_1"), "");
  assert.equal(databaseNameError("é".repeat(31)), "");
  for (const name of ["", " a", "a ", ".", "..", "a/b", "a\\b", "a\n", "é".repeat(32)]) {
    assert.notEqual(databaseNameError(name), "", name);
  }
  assert.notEqual(databaseNameError("client", ["client"]), "");
  assert.equal(databaseNameError("Client", ["client"]), "");
});
