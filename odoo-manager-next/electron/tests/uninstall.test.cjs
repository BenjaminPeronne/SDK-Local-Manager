const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { appRemoval, cleanupCommand, debPackageName, foldersToRemove } = require("../uninstall.cjs");

test("l'application se retire selon son installation", () => {
  assert.deepEqual(
    appRemoval({
      platform: "darwin",
      execPath: "/Applications/SDK Local Manager.app/Contents/MacOS/SDK Local Manager",
    }),
    { kind: "trash", path: "/Applications/SDK Local Manager.app" },
  );
  assert.deepEqual(appRemoval({ platform: "win32", execPath: "C:\\Apps\\SDK\\SDK Local Manager.exe" }), {
    kind: "nsis",
    path: "C:\\Apps\\SDK\\Uninstall SDK Local Manager.exe",
  });
  assert.deepEqual(
    appRemoval({ platform: "linux", execPath: "/tmp/.mount/x", env: { APPIMAGE: "/home/a/SDK.AppImage" } }),
    {
      kind: "file",
      path: "/home/a/SDK.AppImage",
    },
  );
  assert.equal(appRemoval({ platform: "linux", execPath: "/opt/SDK Local Manager/x", env: {} }).kind, "deb");
});

test("nom du paquet Debian lu dans dpkg-query", () => {
  assert.equal(debPackageName("odoo-manager-next: /opt/SDK Local Manager/odoo-manager-next\n"), "odoo-manager-next");
  assert.equal(debPackageName(""), "");
  assert.equal(debPackageName("bad name; rm: /x"), "");
});

test("l'environnement Linux gardé reste en place", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uninstall-"));
  for (const name of ["wsl", "Cookies", "updates"]) fs.mkdirSync(path.join(root, name));
  const kept = foldersToRemove({ folders: [root, "/config", "/config"], keep: path.join(root, "wsl") });
  assert.deepEqual(kept.sort(), [path.join(root, "Cookies"), path.join(root, "updates"), "/config"].sort());
  assert.deepEqual(foldersToRemove({ folders: [root, ""] }), [root]);
  fs.rmSync(root, { recursive: true });
});

test("le nettoyage attend la fermeture sans laisser le shell interpréter les chemins", () => {
  const [command, args] = cleanupCommand({ platform: "linux", pid: 42, paths: ["/a b", "/$(x)"] });
  assert.equal(command, "/bin/sh");
  assert.deepEqual(args.slice(2), ["42", "/a b", "/$(x)"]);
  const [ps, psArgs] = cleanupCommand({ platform: "win32", pid: 7, paths: ["C:\\it's"], then: "C:\\U.exe" });
  assert.equal(ps, "powershell.exe");
  const script = Buffer.from(psArgs.at(-1), "base64").toString("utf16le");
  assert.match(script, /Wait-Process -Id 7/);
  assert.match(script, /-LiteralPath 'C:\\it''s'/);
  assert.match(script, /Start-Process -FilePath 'C:\\U.exe'$/);
});
