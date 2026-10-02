import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCheckedAt, updateCheckStatus } from "./app-update.ts";

const UP_TO_DATE = {
  current: "0.15.0",
  latest: "0.14.0",
  tag: "app-v0.14.0-build2",
  update_available: false,
  url: "https://gitlab.example/releases/app-v0.14.0-build2",
  checked: true,
};

test("the about window says plainly where the update check stands", () => {
  const idle = { checking: false, failure: "" };
  assert.deepEqual(updateCheckStatus(null, idle), { tone: "muted", text: "Aucune recherche pour l'instant." });
  assert.equal(
    updateCheckStatus(UP_TO_DATE, { checking: true, failure: "" }).text,
    "Recherche d'une nouvelle version…",
  );
  assert.deepEqual(updateCheckStatus(UP_TO_DATE, idle), { tone: "success", text: "Tu as la dernière version." });
  assert.deepEqual(
    updateCheckStatus({ ...UP_TO_DATE, latest: "0.16.0", tag: "app-v0.16.0-build1", update_available: true }, idle),
    { tone: "available", text: "La version 0.16.0 est disponible." },
  );
  const refused = { ...UP_TO_DATE, checked: false, error: "GitLab refuse la clé SSH de ce poste." };
  assert.deepEqual(updateCheckStatus(refused, idle), { tone: "error", text: "GitLab refuse la clé SSH de ce poste." });
  // Service local muet : son message passe avant la dernière réponse connue.
  assert.equal(
    updateCheckStatus(UP_TO_DATE, { checking: false, failure: "Le service local ne répond pas." }).tone,
    "error",
  );
});

test("the time of the last check reads naturally", () => {
  const now = new Date(2026, 9, 3, 18, 0);
  const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
  assert.equal(formatCheckedAt(seconds(new Date(2026, 9, 3, 14, 32)), now), "aujourd'hui à 14:32");
  assert.equal(formatCheckedAt(seconds(new Date(2026, 9, 1, 9, 5)), now), "le 01/10 à 09:05");
  assert.equal(formatCheckedAt(undefined, now), "");
});
