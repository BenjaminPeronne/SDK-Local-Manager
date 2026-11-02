import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceLabel } from "./format.ts";

test("the projects folder shows its home and its own name", () => {
  assert.equal(workspaceLabel("/Users/benjamin/Documents/Developer/Projets"), "~/…/Projets");
  assert.equal(workspaceLabel("/home/dev/odoo"), "~/odoo");
  assert.equal(workspaceLabel("/home/dev/work/odoo"), "~/work/odoo");
  assert.equal(workspaceLabel("/opt/odoo/projects/clients"), "/…/clients");
  assert.equal(workspaceLabel("/Users/benjaminx"), "~");
});
