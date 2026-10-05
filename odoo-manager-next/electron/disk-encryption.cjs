"use strict";
// Chiffrement du disque qui porte les bases des clients.
//
// Un ordinateur perdu ou volé sans chiffrement livre toutes les copies de bases clients à qui
// le démarre sur un autre système. Le contrôle vit dans le processus principal et non dans le
// backend : sous Windows, le backend tourne dans l'environnement Linux, qui ne voit pas BitLocker.
//
// Chaque contrôle répond "on", "off" ou "unknown". Dans le doute, "unknown" : l'interface ne
// signale qu'un disque dont l'absence de chiffrement est certaine.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const TIMEOUT_MS = 15000;

/** Réponse de `fdesetup status`. Un déchiffrement en cours affiche aussi « FileVault is On. ». */
function parseFileVault(output) {
  const text = String(output || "");
  if (/Decryption in progress/i.test(text)) return "off";
  if (/FileVault is On|Encryption in progress/i.test(text)) return "on";
  if (/FileVault is Off/i.test(text)) return "off";
  return "unknown";
}

// System.Volume.BitLockerProtection, lisible sans droits administrateur (manage-bde les exige).
// 1 activé, 3 chiffrement en cours, 6 activé et verrouillé ; 2 désactivé, 4 déchiffrement en
// cours, 5 suspendu (la clé est alors en clair sur le disque), 8 en attente d'activation
// (chiffrement de l'appareil pas encore lié à un compte : la clé est en clair).
const BITLOCKER_ON = new Set(["1", "3", "6"]);
const BITLOCKER_OFF = new Set(["2", "4", "5", "8"]);

function parseBitLocker(output) {
  const value = String(output || "").trim();
  if (BITLOCKER_ON.has(value)) return "on";
  if (BITLOCKER_OFF.has(value)) return "off";
  return "unknown";
}

/**
 * Lecteur Windows qui porte les bases : celui du dossier des projets s'il est sur un lecteur
 * Windows, sinon celui du disque de l'environnement Linux (dossier des projets côté Linux).
 */
function windowsDataDrive(workspace, fallbackPath) {
  for (const candidate of [workspace, fallbackPath]) {
    const match = /^([A-Za-z]):[\\/]/.exec(String(candidate || ""));
    if (match) return match[1].toUpperCase() + ":";
  }
  return "";
}

/** `findmnt -n -o SOURCE,FSTYPE` : périphérique sans la sous-arborescence btrfs, et système de fichiers. */
function parseFindmnt(output) {
  const [source = "", fstype = ""] = String(output || "")
    .trim()
    .split(/\s+/);
  return { source: source.replace(/\[.*\]$/, ""), fstype };
}

/** `lsblk -s -n -o TYPE` remonte du périphérique jusqu'au disque : un maillon `crypt` (LUKS) suffit. */
function parseLsblkTypes(output) {
  const types = String(output || "")
    .split(/\s+/)
    .filter(Boolean);
  if (types.includes("crypt")) return "on";
  return types.includes("disk") ? "off" : "unknown";
}

/**
 * Dossier existant le plus proche : le dossier des projets n'existe pas forcément encore.
 * Chemins Linux : `path.posix` explicitement, pour que les tests tournent aussi sous Windows.
 */
function existingAncestor(directory, exists) {
  let current = path.posix.resolve(directory);
  while (!exists(current)) {
    const parent = path.posix.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

async function linuxState(directory, run) {
  const mount = parseFindmnt((await run("findmnt", ["-n", "-o", "SOURCE,FSTYPE", "--target", directory])).stdout);
  if (mount.fstype === "ecryptfs") return "on";
  // ZFS, réseau, overlay… : rien de sûr à dire.
  if (!mount.source.startsWith("/dev/")) return "unknown";
  return parseLsblkTypes((await run("lsblk", ["-s", "-n", "-o", "TYPE", mount.source])).stdout);
}

async function diskEncryptionStatus({
  platform = process.platform,
  workspace = "",
  fallbackPath = "",
  home = os.homedir(),
  exists = fs.existsSync,
  run = defaultRunner,
} = {}) {
  try {
    if (platform === "darwin") return parseFileVault((await run("fdesetup", ["status"])).stdout);
    if (platform === "win32") {
      const drive = windowsDataDrive(workspace, fallbackPath);
      if (!drive) return "unknown";
      // Lecteur validé par windowsDataDrive (une lettre et deux-points) : rien d'autre n'entre dans le script.
      const script = `(New-Object -ComObject Shell.Application).NameSpace('${drive}').Self.ExtendedProperty('System.Volume.BitLockerProtection')`;
      return parseBitLocker(
        (await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script])).stdout,
      );
    }
    if (platform === "linux") {
      const directory = path.posix.isAbsolute(String(workspace || "")) ? workspace : home;
      return await linuxState(existingAncestor(directory, exists), run);
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

function defaultRunner(executable, args) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true, timeout: TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error);
      else resolve({ stdout });
    });
  });
}

module.exports = {
  diskEncryptionStatus,
  parseBitLocker,
  parseFileVault,
  parseFindmnt,
  parseLsblkTypes,
  windowsDataDrive,
};
