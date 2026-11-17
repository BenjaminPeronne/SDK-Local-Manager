import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, workspaceLabel } from "./format.ts";

test("the projects folder shows its home and its own name", () => {
  assert.equal(workspaceLabel("/Users/benjamin/Documents/Developer/Projets"), "~/…/Projets");
  assert.equal(workspaceLabel("/home/dev/odoo"), "~/odoo");
  assert.equal(workspaceLabel("/home/dev/work/odoo"), "~/work/odoo");
  assert.equal(workspaceLabel("/opt/odoo/projects/clients"), "/…/clients");
  assert.equal(workspaceLabel("/Users/benjaminx"), "~");
});

test("durations read as hours and minutes", () => {
  assert.equal(formatDuration(30), "moins d’une minute");
  assert.equal(formatDuration(12 * 60 + 59), "12 min");
  assert.equal(formatDuration(2 * 3600 + 5 * 60), "2 h 05");
  assert.equal(formatDuration(-5), "moins d’une minute");
});
