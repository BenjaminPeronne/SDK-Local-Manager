const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  diskEncryptionStatus,
  parseBitLocker,
  parseFileVault,
  parseFindmnt,
  parseLsblkTypes,
  windowsDataDrive,
} = require("../disk-encryption.cjs");

/** Exécutant simulé : réponses par exécutable, et relevé des commandes lancées. */
function runner(outputs) {
  const calls = [];
  const run = async (executable, args) => {
    calls.push([executable, ...args]);
    const output = outputs[executable];
    if (output instanceof Error) throw output;
    return { stdout: output ?? "" };
  };
  return { run, calls };
}

test("FileVault states are read from fdesetup", () => {
  assert.equal(parseFileVault("FileVault is On.\n"), "on");
  assert.equal(parseFileVault("Encryption in progress: Percent completed = 12.5\n"), "on");
  assert.equal(parseFileVault("FileVault is Off.\n"), "off");
  // Un déchiffrement en cours se présente aussi comme « On » : le disque ne sera bientôt plus protégé.
  assert.equal(parseFileVault("FileVault is On.\nDecryption in progress: Percent completed = 40\n"), "off");
  assert.equal(parseFileVault(""), "unknown");
});

test("BitLocker codes are mapped, and anything else stays unknown", () => {
  for (const code of ["1", "3", "6"]) assert.equal(parseBitLocker(`${code}\r\n`), "on", code);
  for (const code of ["2", "4", "5", "8"]) assert.equal(parseBitLocker(code), "off", code);
  for (const output of ["", "0", "7", "erreur"]) assert.equal(parseBitLocker(output), "unknown", output);
});

test("on Windows the drive holding the databases is checked", () => {
  assert.equal(windowsDataDrive("D:\\Odoo-projects", "C:\\Users\\a\\AppData\\Roaming\\SDK Local Manager\\wsl"), "D:");
  // Projets dans l'environnement Linux : ils vivent sur le disque de cet environnement.
  assert.equal(windowsDataDrive("/home/sdk/Odoo-projects", "e:\\AppData\\SDK Local Manager\\wsl"), "E:");
  assert.equal(windowsDataDrive("/home/sdk/Odoo-projects", ""), "");
});

test("Linux mounts and block device chains are parsed", () => {
  assert.deepEqual(parseFindmnt("/dev/nvme0n1p2[/@home] btrfs\n"), { source: "/dev/nvme0n1p2", fstype: "btrfs" });
  assert.equal(parseLsblkTypes("lvm\ncrypt\npart\ndisk\n"), "on");
  assert.equal(parseLsblkTypes("part\ndisk\n"), "off");
  assert.equal(parseLsblkTypes(""), "unknown");
});

test("macOS asks fdesetup", async () => {
  const { run, calls } = runner({ fdesetup: "FileVault is Off.\n" });
  assert.equal(await diskEncryptionStatus({ platform: "darwin", run }), "off");
  assert.deepEqual(calls, [["fdesetup", "status"]]);
});

test("Windows reads the BitLocker state of a validated drive letter only", async () => {
  const { run, calls } = runner({ "powershell.exe": "1\r\n" });
  assert.equal(await diskEncryptionStatus({ platform: "win32", workspace: "D:\\Odoo", run }), "on");
  assert.equal(calls[0][0], "powershell.exe");
  assert.match(calls[0].at(-1), /NameSpace\('D:'\)/);

  // Aucun lecteur reconnu : rien n'est lancé.
  const none = runner({});
  assert.equal(
    await diskEncryptionStatus({ platform: "win32", workspace: "'; Remove-Item x", run: none.run }),
    "unknown",
  );
  assert.deepEqual(none.calls, []);
});

test("Linux follows the projects folder down to its disk", async () => {
  const { run, calls } = runner({ findmnt: "/dev/mapper/vg-root ext4\n", lsblk: "lvm\ncrypt\npart\ndisk\n" });
  const exists = (candidate) => candidate === "/home/dev";
  const state = await diskEncryptionStatus({ platform: "linux", workspace: "/home/dev/Odoo-projects", exists, run });
  assert.equal(state, "on");
  // Le dossier des projets n'existe pas encore : son parent le plus proche est contrôlé.
  assert.deepEqual(calls[0], ["findmnt", "-n", "-o", "SOURCE,FSTYPE", "--target", "/home/dev"]);
  assert.deepEqual(calls[1], ["lsblk", "-s", "-n", "-o", "TYPE", "/dev/mapper/vg-root"]);
});

test("Linux setups that cannot be traced stay unknown", async () => {
  const exists = () => true;
  const zfs = runner({ findmnt: "rpool/home zfs\n" });
  assert.equal(
    await diskEncryptionStatus({ platform: "linux", workspace: "/home/dev", exists, run: zfs.run }),
    "unknown",
  );
  assert.equal(zfs.calls.length, 1);
  const ecryptfs = runner({ findmnt: "/home/.ecryptfs/dev/.Private ecryptfs\n" });
  assert.equal(
    await diskEncryptionStatus({ platform: "linux", workspace: "/home/dev", exists, run: ecryptfs.run }),
    "on",
  );
});

test("a failing command never raises an alarm", async () => {
  const { run } = runner({ fdesetup: new Error("introuvable"), findmnt: new Error("introuvable") });
  assert.equal(await diskEncryptionStatus({ platform: "darwin", run }), "unknown");
  assert.equal(await diskEncryptionStatus({ platform: "linux", workspace: "/", exists: () => true, run }), "unknown");
  assert.equal(await diskEncryptionStatus({ platform: "freebsd", run }), "unknown");
});
