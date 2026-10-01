import { test } from "node:test";
import assert from "node:assert/strict";
import { confettiPreviewRequested, localDayKey, newYearGreeting, seasonAt, seasonOverride } from "./seasonal.ts";

test("halloween decorations run from the twenty-fifth to the thirty-first of October", () => {
  assert.equal(seasonAt(new Date(2026, 9, 25, 0, 0)), "halloween");
  assert.equal(seasonAt(new Date(2026, 9, 31, 23, 59)), "halloween");
  assert.equal(seasonAt(new Date(2026, 9, 24, 23, 59)), null);
  assert.equal(seasonAt(new Date(2026, 10, 1, 0, 0)), null);
});

test("christmas decorations run from the first to the thirtieth of December", () => {
  assert.equal(seasonAt(new Date(2026, 11, 1, 0, 0)), "christmas");
  assert.equal(seasonAt(new Date(2026, 11, 25, 12, 0)), "christmas");
  assert.equal(seasonAt(new Date(2026, 11, 30, 23, 59)), "christmas");
});

test("new year decorations run from the thirty-first of December to the second of January", () => {
  assert.equal(seasonAt(new Date(2026, 11, 31, 0, 0)), "new-year");
  assert.equal(seasonAt(new Date(2027, 0, 1, 0, 0)), "new-year");
  assert.equal(seasonAt(new Date(2027, 0, 2, 23, 59)), "new-year");
});

test("no decoration outside the season", () => {
  assert.equal(seasonAt(new Date(2026, 10, 30, 23, 59)), null);
  assert.equal(seasonAt(new Date(2027, 0, 3, 0, 0)), null);
  assert.equal(seasonAt(new Date(2026, 6, 14)), null);
});

test("the address can force or turn off a season", () => {
  assert.equal(seasonOverride(""), undefined);
  assert.equal(seasonOverride("?project=demo"), undefined);
  assert.equal(seasonOverride("?season=halloween"), "halloween");
  assert.equal(seasonOverride("?season=christmas"), "christmas");
  assert.equal(seasonOverride("?season=new-year"), "new-year");
  assert.equal(seasonOverride("?season=none"), null);
  assert.equal(seasonOverride("?season=unknown"), null);
});

test("the new year greeting names the coming year on New Year's Eve", () => {
  assert.equal(newYearGreeting(new Date(2026, 11, 31)), "Bientôt 2027 ! Belle fin d’année 🎉");
  assert.equal(newYearGreeting(new Date(2027, 0, 1)), "Bonne année 2027 ! 🎉");
  assert.equal(newYearGreeting(new Date(2027, 0, 2)), "Bonne année 2027 ! 🎉");
});

test("the local day key is padded and follows local time", () => {
  assert.equal(localDayKey(new Date(2027, 0, 2, 23, 59)), "2027-01-02");
  assert.equal(localDayKey(new Date(2026, 11, 31, 0, 0)), "2026-12-31");
});

test("the address can ask for a confetti preview", () => {
  assert.equal(confettiPreviewRequested("?season=new-year&confetti=1"), true);
  assert.equal(confettiPreviewRequested("?season=new-year"), false);
  assert.equal(confettiPreviewRequested("?confetti=0"), false);
});
