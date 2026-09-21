import { test } from "node:test";
import assert from "node:assert/strict";
import { handleListKeys } from "./list-navigation.ts";

function press(key: string, count: number, active: number) {
  const calls: { active?: number; chosen?: number; prevented: boolean } = { prevented: false };
  handleListKeys(
    { key, preventDefault: () => { calls.prevented = true; } },
    count,
    active,
    (index) => { calls.active = index; },
    (index) => { calls.chosen = index; },
  );
  return calls;
}

test("arrows move the active row without leaving the list", () => {
  assert.equal(press("ArrowDown", 5, 1).active, 2);
  assert.equal(press("ArrowDown", 5, 4).active, 4);
  assert.equal(press("ArrowUp", 5, 2).active, 1);
  assert.equal(press("ArrowUp", 5, 0).active, 0);
});

test("Enter chooses the active row and never submits the dialog", () => {
  const enter = press("Enter", 5, 3);
  assert.equal(enter.chosen, 3);
  assert.equal(enter.prevented, true);
  // Liste raccourcie par la recherche : la dernière ligne existante est choisie.
  assert.equal(press("Enter", 2, 4).chosen, 1);
});

test("typing keys stay with the search field", () => {
  const letter = press("a", 5, 0);
  assert.equal(letter.prevented, false);
  assert.equal(letter.active, undefined);
  assert.equal(letter.chosen, undefined);
});

test("an empty list ignores every key", () => {
  const enter = press("Enter", 0, 0);
  assert.equal(enter.prevented, false);
  assert.equal(enter.chosen, undefined);
});
