import { test } from "node:test";
import assert from "node:assert/strict";
import { windowsPathFromMount } from "./projects.ts";

test("a Windows drive mounted in the Linux environment is shown as Windows writes it", () => {
  assert.equal(windowsPathFromMount("/mnt/d/Projets/Odoo"), "D:\\Projets\\Odoo");
  assert.equal(windowsPathFromMount("/mnt/c"), "C:\\");
});

test("other paths are shown unchanged", () => {
  assert.equal(windowsPathFromMount("/home/sdk/Odoo-projects"), "/home/sdk/Odoo-projects");
  assert.equal(windowsPathFromMount(""), "");
});
