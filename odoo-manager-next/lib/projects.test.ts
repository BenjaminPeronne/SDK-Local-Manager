import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupProjectsBySection,
  moveProjectToSection,
  odooAccessUrl,
  odooServerStopped,
  projectListRank,
  runningProjectDatabaseCount,
  windowsPathFromMount,
} from "./projects.ts";

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

test("a started container without its Odoo server is told apart from a running project", () => {
  assert.equal(odooServerStopped({ odoo_status: "running", odoo_server: "stopped" }), true);
  assert.equal(odooServerStopped({ odoo_status: "running", odoo_server: "running" }), false);
  // Docker trop lent pour répondre : rien ne prouve que le serveur est arrêté.
  assert.equal(odooServerStopped({ odoo_status: "running", odoo_server: "unknown" }), false);
  assert.equal(odooServerStopped({ odoo_status: "exited", odoo_server: null }), false);
  assert.equal(odooServerStopped(undefined), false);
});

test("database count is shown only when both containers are running", () => {
  const project = { odoo_status: "running", postgres_status: "running", databases: ["postgres", "demo"] };
  assert.equal(runningProjectDatabaseCount(project), 1);
  assert.equal(runningProjectDatabaseCount({ ...project, databases: ["postgres"] }), 0);
  assert.equal(runningProjectDatabaseCount({ ...project, odoo_status: "exited" }), null);
  assert.equal(runningProjectDatabaseCount({ ...project, postgres_status: "exited" }), null);
});

test("a project whose container runs without Odoo stays above the stopped ones", () => {
  const odooOn = projectListRank({ odoo_status: "running", odoo_server: "running" });
  const containerOnly = projectListRank({ odoo_status: "running", odoo_server: "stopped" });
  const stopped = projectListRank({ odoo_status: "exited", odoo_server: null });
  const absent = projectListRank({ odoo_status: "absent", odoo_server: null });
  assert.ok(odooOn > containerOnly && containerOnly > stopped);
  assert.equal(stopped, absent);
  assert.equal(projectListRank({ odoo_status: "absent", odoo_server: null }, true), odooOn);
});

test("projects follow their section order, with unfiled ones last in the order received", () => {
  const sections = [
    { id: "a", name: "Clients", projects: ["c", "gone", "a"], collapsed: false },
    { id: "b", name: "Vide", projects: [], collapsed: true },
  ];
  const groups = groupProjectsBySection([{ name: "a" }, { name: "b" }, { name: "c" }], sections);
  assert.deepEqual(
    groups.map((group) => [group.section?.id ?? null, group.projects.map((project) => project.name)]),
    [
      ["a", ["c", "a"]],
      ["b", []],
      [null, ["b"]],
    ],
  );
});

test("moving a project takes it out of its previous section", () => {
  const sections = [
    { id: "a", name: "A", projects: ["x"], collapsed: false },
    { id: "b", name: "B", projects: [], collapsed: false },
  ];
  const moved = moveProjectToSection(sections, "x", "b");
  assert.deepEqual(
    moved.map((section) => section.projects),
    [[], ["x"]],
  );
  assert.deepEqual(
    moveProjectToSection(moved, "x", null).map((section) => section.projects),
    [[], []],
  );
});

test("a dragged project lands before the project it is dropped on", () => {
  const sections = [{ id: "a", name: "A", projects: ["x", "y", "z"], collapsed: false }];
  assert.deepEqual(moveProjectToSection(sections, "z", "a", "x")[0].projects, ["z", "x", "y"]);
  assert.deepEqual(moveProjectToSection(sections, "x", "a", "z")[0].projects, ["y", "x", "z"]);
  assert.deepEqual(moveProjectToSection(sections, "x", "a", "gone")[0].projects, ["y", "z", "x"]);
});
