import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntil, deletionLabel, notificationKey, upcomingDeletions } from "./retention.ts";
import type { Project } from "./types.ts";

const NOW = new Date(2026, 9, 4, 10, 0);
const at = (day: number, hour = 9) => new Date(2026, 9, day, hour, 0).getTime() / 1000;

function project(name: string, retention: Project["database_retention"]): Project {
  return {
    name,
    odoo_status: "running",
    postgres_status: "running",
    url: "",
    database_manager_url: "",
    databases: Object.keys(retention ?? {}),
    database_retention: retention,
  };
}

test("days are counted on the calendar, not in blocks of 24 hours", () => {
  assert.equal(daysUntil(at(4, 23), NOW), 0);
  assert.equal(daysUntil(at(5, 1), NOW), 1);
  assert.equal(daysUntil(at(11), NOW), 7);
  assert.equal(daysUntil(at(1), NOW), 0);
});

test("each database card says when it will be deleted", () => {
  assert.deepEqual(deletionLabel(at(3), NOW), { text: "Supprimée dès que possible", tone: "danger" });
  assert.deepEqual(deletionLabel(at(4, 20), NOW), { text: "Supprimée aujourd’hui", tone: "danger" });
  assert.deepEqual(deletionLabel(at(5), NOW), { text: "Supprimée demain", tone: "danger" });
  assert.deepEqual(deletionLabel(at(9), NOW), { text: "Supprimée dans 5 jours", tone: "warning" });
  assert.deepEqual(deletionLabel(at(30), NOW), { text: "Supprimée le 30 octobre", tone: "muted" });
});

test("only deletions within a week are announced, the closest first", () => {
  const projects = [
    project("A", {
      later: { expires_at: at(30), origin: "restored" },
      soon: { expires_at: at(9), origin: "restored" },
    }),
    project("B", { empty: { expires_at: null, origin: "created" }, now: { expires_at: at(5), origin: "detected" } }),
  ];
  assert.deepEqual(
    upcomingDeletions(projects, NOW).map(({ project, db, days }) => [project, db, days]),
    [
      ["B", "now", 1],
      ["A", "soon", 5],
    ],
  );
});

test("a notification is sent once per step and per deadline", () => {
  const deletion = { project: "A", db: "prod", expiresAt: at(9), days: 5 };
  assert.equal(notificationKey(deletion), `retention-notified:A/prod/${at(9)}/7`);
  assert.equal(notificationKey({ ...deletion, days: 1 }), `retention-notified:A/prod/${at(9)}/1`);
  // Échéance repoussée : nouvelle clé, nouvel avertissement le moment venu.
  assert.notEqual(notificationKey({ ...deletion, expiresAt: at(20) }), notificationKey(deletion));
});
