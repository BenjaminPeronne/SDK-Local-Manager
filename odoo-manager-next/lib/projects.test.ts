import { test } from "node:test";
import assert from "node:assert/strict";
import { odooAccessUrl, windowsPathFromMount } from "./projects.ts";

test("a Windows drive mounted in the Linux environment is shown as Windows writes it", () => {
  assert.equal(windowsPathFromMount("/mnt/d/Projets/Odoo"), "D:\\Projets\\Odoo");
  assert.equal(windowsPathFromMount("/mnt/c"), "C:\\");
});

test("other paths are shown unchanged", () => {
  assert.equal(windowsPathFromMount("/home/sdk/Odoo-projects"), "/home/sdk/Odoo-projects");
  assert.equal(windowsPathFromMount(""), "");
});

const project = { url: "http://dev.demo.localhost:8080/" } as Parameters<typeof odooAccessUrl>[0];

test("Odoo opens on the selected database", () => {
  assert.equal(odooAccessUrl(project, "demo"), "http://dev.demo.localhost:8080/web?db=demo");
  assert.equal(odooAccessUrl(project, "postgres"), "http://dev.demo.localhost:8080/");
  assert.equal(odooAccessUrl(project), "http://dev.demo.localhost:8080/");
});

test("debug modes are added to the Odoo URL, with or without a database", () => {
  assert.equal(odooAccessUrl(project, "demo", "1"), "http://dev.demo.localhost:8080/web?db=demo&debug=1");
  assert.equal(odooAccessUrl(project, "", "assets"), "http://dev.demo.localhost:8080/web?debug=assets");
});
