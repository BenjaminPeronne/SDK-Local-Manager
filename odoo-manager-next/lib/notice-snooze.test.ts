import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTICE_SNOOZE_DAYS, noticeSnoozed } from "./notice-snooze.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 5, 10, 0).getTime();

test("a banner hidden for 30 days comes back afterwards", () => {
  const dismissedAt = String(NOW);
  assert.equal(noticeSnoozed(dismissedAt, NOW + DAY_MS), true);
  assert.equal(noticeSnoozed(dismissedAt, NOW + NOTICE_SNOOZE_DAYS * DAY_MS - 1), true);
  assert.equal(noticeSnoozed(dismissedAt, NOW + NOTICE_SNOOZE_DAYS * DAY_MS), false);
});

test("a banner never hidden, or with an unreadable date, is shown", () => {
  assert.equal(noticeSnoozed("", NOW), false);
  assert.equal(noticeSnoozed("pas une date", NOW), false);
});

test("a date in the future does not hide the banner", () => {
  // Horloge du poste en avance au moment du masquage, puis corrigée : le bandeau revient tout de suite.
  assert.equal(noticeSnoozed(String(NOW + 10 * DAY_MS), NOW), false);
});
