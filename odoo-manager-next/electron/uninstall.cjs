/**
 * Désinstallation, une fois que le backend a arrêté les conteneurs et retiré leurs données :
 * l'application se retire selon la façon dont elle a été installée, puis un processus détaché
 * attend sa fermeture pour effacer configuration et journaux (Chromium écrit dans son dossier
 * jusqu'à la dernière seconde, et Windows verrouille les fichiers ouverts).
 */
const fs = require("node:fs");
const path = require("node:path");

const UNINSTALLER = "Uninstall SDK Local Manager.exe";

function appRemoval({ platform = process.platform, execPath = process.execPath, env = process.env } = {}) {
  if (platform === "darwin") {
    const bundle = /^(.*?\.app)\//.exec(execPath);
    return bundle ? { kind: "trash", path: bundle[1] } : null;
  }
  if (platform === "win32") return { kind: "nsis", path: path.win32.join(path.win32.dirname(execPath), UNINSTALLER) };
  return env.APPIMAGE ? { kind: "file", path: env.APPIMAGE } : { kind: "deb", path: execPath };
}

// `dpkg-query -S` répond « paquet: /chemin » ; plusieurs paquets sont séparés par des virgules.
function debPackageName(output) {
  const name = String(output || "")
    .split(":")[0]
    .split(",")[0]
    .trim();
  return /^[a-z0-9][a-z0-9.+-]+$/.test(name) ? name : "";
}

// Sous Windows, l'environnement Linux gardé (projets conservés) est dans le dossier de l'application.
function foldersToRemove({ folders, keep = "" }) {
  const result = [];
  for (const folder of new Set(folders.filter(Boolean))) {
    if (!keep || path.dirname(keep) !== folder) {
      result.push(folder);
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(folder);
    } catch {
      /* absent */
    }
    result.push(...entries.filter((name) => name !== path.basename(keep)).map((name) => path.join(folder, name)));
  }
  return result;
}

function cleanupCommand({ platform = process.platform, pid = process.pid, paths, then = "" }) {
  if (platform !== "win32") {
    // Chemins passés en arguments : aucun n'est interprété par le shell.
    return [
      "/bin/sh",
      ["-c", 'while kill -0 "$0" 2>/dev/null; do sleep 0.5; done; rm -rf -- "$@"', String(pid), ...paths],
    ];
  }
  const quote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
  const script = [
    `Wait-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue`,
    "Start-Sleep -Seconds 1",
    ...paths.map((item) => `Remove-Item -LiteralPath ${quote(item)} -Recurse -Force -ErrorAction SilentlyContinue`),
    then ? `Start-Process -FilePath ${quote(then)}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return [
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
  ];
}

module.exports = { appRemoval, cleanupCommand, debPackageName, foldersToRemove, UNINSTALLER };
