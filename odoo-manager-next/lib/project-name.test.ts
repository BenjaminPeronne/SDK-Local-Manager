import { test } from "node:test";
import assert from "node:assert/strict";
import { existingProjectNamed, normalizeProjectName } from "./project-name.ts";

test("project names typed in capitals become valid lowercase addresses", () => {
  assert.equal(normalizeProjectName("MABONNEETOILE"), "mabonneetoile");
  assert.equal(normalizeProjectName("CLIENT V19", { final: true }), "client_v19");
  assert.equal(normalizeProjectName("Société Générale  v16", { final: true }), "societe_generale_v16");
  assert.equal(normalizeProjectName("Cœur d'Alène", { final: true }), "coeur_d_alene");
  assert.equal(normalizeProjectName("client.v19-test_2"), "client.v19-test_2");
});

test("separators stay typeable at the end and never start a name", () => {
  assert.equal(normalizeProjectName("client "), "client_");
  assert.equal(normalizeProjectName("client ", { final: true }), "client");
  assert.equal(normalizeProjectName("__-.client"), "client");
  assert.equal(normalizeProjectName("  "), "");
  assert.equal(normalizeProjectName("x".repeat(80)).length, 63);
});

test("an existing project with another case is the same address", () => {
  const projects = [{ name: "AKAAZ" }, { name: "aca_v16" }];

  assert.equal(existingProjectNamed("akaaz", projects)?.name, "AKAAZ");
  assert.equal(existingProjectNamed("aca_v17", projects), undefined);
  assert.equal(existingProjectNamed("", projects), undefined);
});
