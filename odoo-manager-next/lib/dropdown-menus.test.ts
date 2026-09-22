import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

function sourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return entry.name.endsWith(".tsx") ? [url] : [];
  });
}

// Un menu modal verrouille le défilement du body ; avec html en overflow-x: clip,
// l'en-tête du projet et la barre latérale collés disparaissent pendant l'ouverture.
test("every dropdown menu is non-modal to keep sticky layout in place", () => {
  const files = [new URL("../app/", import.meta.url), new URL("../components/", import.meta.url)].flatMap(sourceFiles);
  const roots = files.flatMap((file) => readFileSync(file, "utf8").match(/<DropdownMenu\.Root\b[^>]*>/g) ?? []);
  assert.ok(roots.length > 0);
  assert.deepEqual(
    roots.filter((root) => !root.includes("modal={false}")),
    [],
  );
});
