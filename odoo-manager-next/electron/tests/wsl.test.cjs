const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  BACKEND_PATH,
  WslEnvironment,
  wslStartFailureReason,
  legacyWindowsWorkspace,
  backendCommand,
  decodeWslOutput,
  expectedChecksum,
  imageFiles,
  importArguments,
  parseDistributions,
  parseWslVersion,
  supportsFileImport,
} = require("../wsl.cjs");

const utf16 = (text) => Buffer.from(text, "utf16le");

test("wsl.exe output is decoded from UTF-16", () => {
  assert.deepEqual(parseDistributions(utf16("Ubuntu\r\nSDK-Manager\r\ndocker-desktop\r\n")), [
    "Ubuntu",
    "SDK-Manager",
    "docker-desktop",
  ]);
  assert.equal(parseWslVersion(utf16("Version WSL : 2.4.12.0\r\nVersion du noyau : 5.15.167.4-1\r\n")), "2.4.12.0");
  assert.equal(decodeWslOutput(Buffer.from("déjà en UTF-8", "utf8")), "déjà en UTF-8");
});

test("file import needs WSL 2.4.4 or newer", () => {
  assert.equal(supportsFileImport("2.4.12.0"), true);
  assert.equal(supportsFileImport("2.4.4"), true);
  assert.equal(supportsFileImport("2.4.3"), false);
  assert.equal(supportsFileImport("2.0.9"), false);
  assert.equal(supportsFileImport(""), false);
});

test("import keeps the distribution out of the default location and does not launch it", () => {
  assert.deepEqual(importArguments({ archive: "C:\\img.wsl", location: "C:\\data\\wsl" }), [
    "--install",
    "--from-file",
    "C:\\img.wsl",
    "--name",
    "SDK-Manager",
    "--location",
    "C:\\data\\wsl",
    "--no-launch",
  ]);
});

test("backend runs inside the distribution with its port, since wsl.exe passes no environment", () => {
  const { executable, args } = backendCommand({ port: 18771, instance: "abc-123" });
  assert.equal(executable, "wsl.exe");
  assert.deepEqual(args, [
    "-d",
    "SDK-Manager",
    "--exec",
    "env",
    "ODOO_GUI_HOST=127.0.0.1",
    "ODOO_GUI_PORT=18771",
    "ODOO_MANAGER_INSTANCE_ID=abc-123",
    BACKEND_PATH,
  ]);
});

test("packaged image, checksum and provisioning script sit next to each other", () => {
  const files = imageFiles("C:\\app\\resources", "0.5.0");
  assert.equal(files.archive, path.join("C:\\app\\resources", "wsl", "sdk-manager-0.5.0.wsl"));
  assert.equal(files.checksum, files.archive + ".sha256");
  assert.equal(files.provisionScript, path.join("C:\\app\\resources", "wsl", "provision.sh"));
});

test("checksum file is read strictly", () => {
  const digest = "a".repeat(64);
  assert.equal(expectedChecksum(`${digest}  sdk-manager-0.5.0.wsl\n`), digest);
  assert.throws(() => expectedChecksum("pas une empreinte"));
});

test("the Windows projects folder is seen from the distribution under /mnt", () => {
  assert.equal(
    WslEnvironment.mountedWindowsPath("C:\\Users\\aymerick\\Odoo-projects"),
    "/mnt/c/Users/aymerick/Odoo-projects",
  );
  assert.equal(WslEnvironment.mountedWindowsPath("D:/Data/Odoo-projects/"), "/mnt/d/Data/Odoo-projects");
  assert.equal(WslEnvironment.mountedWindowsPath("\\\\wsl.localhost\\SDK-Manager\\home\\sdk"), "");
  assert.equal(WslEnvironment.mountedWindowsPath(""), "");
});

function fakeEnvironment({
  distributions = [],
  release = "",
  version = "2.4.12.0",
  backendId = "",
  provisionId = "",
} = {}) {
  const calls = [];
  const runner = async (executable, args) => {
    calls.push([executable, ...args].join(" "));
    if (args.includes("--version")) return { stdout: utf16(`Version WSL : ${version}\r\n`), stderr: "", code: 0 };
    if (args.includes("--list")) return { stdout: utf16(distributions.join("\r\n") + "\r\n"), stderr: "", code: 0 };
    if (args.includes("cat")) {
      const value = args.some((arg) => arg.endsWith(".build-id"))
        ? backendId
        : args.some((arg) => arg.endsWith(".provision-id"))
          ? provisionId
          : release;
      if (!value) throw new Error("fichier absent");
      return { stdout: Buffer.from(value + "\n"), stderr: "", code: 0 };
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), code: 0 };
  };
  return { calls, runner };
}

function backendBuild(content = "ELF backend") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-backend-"));
  fs.writeFileSync(path.join(directory, "odoo-manager-backend"), content);
  fs.mkdirSync(path.join(directory, "odoo-manager-backend-runtime"));
  return { directory, id: createHash("sha256").update(content).digest("hex") };
}

test("status reports what the setup screen needs, without changing anything", async () => {
  const { calls, runner } = fakeEnvironment({ distributions: ["Ubuntu", "SDK-Manager"], release: "0.5.0" });
  const environment = new WslEnvironment({ runner, installRoot: "C:\\data\\wsl" });

  assert.deepEqual(await environment.status(), {
    wslInstalled: true,
    wslVersion: "2.4.12.0",
    supportsFileImport: true,
    distribution: "SDK-Manager",
    distributionInstalled: true,
    release: "0.5.0",
  });
  assert.ok(calls.every((call) => !call.includes("--install")));
});

test("an image that does not match its checksum is refused", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-wsl-"));
  try {
    const archive = path.join(directory, "image.wsl");
    fs.writeFileSync(archive, "racine du système");
    fs.writeFileSync(archive + ".sha256", `${"b".repeat(64)}  image.wsl\n`);
    const { calls, runner } = fakeEnvironment();
    const environment = new WslEnvironment({ runner, installRoot: path.join(directory, "install") });

    await assert.rejects(
      () => environment.importDistribution({ archive, checksum: archive + ".sha256" }),
      /ne correspond pas à son empreinte/,
    );
    assert.ok(calls.every((call) => !call.includes("--install")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a matching image is imported once and marked sparse", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-wsl-"));
  try {
    const archive = path.join(directory, "image.wsl");
    const content = "racine du système";
    fs.writeFileSync(archive, content);
    fs.writeFileSync(archive + ".sha256", `${createHash("sha256").update(content).digest("hex")}  image.wsl\n`);
    const { calls, runner } = fakeEnvironment();
    const installRoot = path.join(directory, "install");
    const environment = new WslEnvironment({ runner, installRoot });

    await environment.importDistribution({ archive, checksum: archive + ".sha256" });

    assert.ok(calls.some((call) => call.includes("--from-file") && call.includes(installRoot)));
    assert.ok(calls.some((call) => call.includes("--set-sparse true")));
    assert.ok(fs.existsSync(installRoot));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an up-to-date distribution is neither reimported, reprovisioned nor recopied", async () => {
  const build = backendBuild();
  try {
    const { calls, runner } = fakeEnvironment({
      distributions: ["SDK-Manager"],
      release: "0.5.0",
      backendId: build.id,
    });
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\\data\\wsl",
      mountPath: () => "/mnt/c/app/backend-linux",
    });

    await environment.prepare({
      version: "0.5.0",
      backendSource: build.directory,
      archive: "C:\\img.wsl",
      checksum: "C:\\img.wsl.sha256",
    });

    assert.ok(calls.every((call) => !call.includes("--from-file")));
    assert.ok(calls.every((call) => !call.includes("provision.sh")));
    assert.ok(calls.every((call) => !call.includes("install-backend")));
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("a new build of the same version still replaces the backend", async () => {
  // Cas rencontré en recette : 0.5.0 installée, nouveau build 0.5.0 avec un autre backend.
  const build = backendBuild("nouveau backend");
  try {
    const { calls, runner } = fakeEnvironment({
      distributions: ["SDK-Manager"],
      release: "0.5.0",
      backendId: "ancien",
    });
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\\data\\wsl",
      mountPath: () => "/mnt/c/app/backend-linux",
    });

    await environment.prepare({
      version: "0.5.0",
      backendSource: build.directory,
      archive: "C:\\img.wsl",
      checksum: "C:\\img.wsl.sha256",
    });

    const install = calls.find((call) => call.includes("install-backend"));
    assert.ok(install, "le backend doit être recopié");
    assert.ok(install.includes("/mnt/c/app/backend-linux"));
    assert.ok(install.includes(build.id));
    assert.ok(
      calls.every((call) => !call.includes("provision.sh")),
      "même version : pas de provisionnement",
    );
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("a Linux environment that stops starting is explained in terms the user can act on", () => {
  const windowsError = new Error(
    "WSL2 ne peut pas démarrer, car la virtualisation n’est pas activée sur cet ordinateur.\n" +
      "Code d'erreur : Wsl/Service/CreateInstance/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED",
  );

  assert.match(wslStartFailureReason(windowsError), /virtualisation est désactivée/);
  assert.match(wslStartFailureReason(new Error("Wsl/Service/CreateInstance/0x8007019e")), /WSL n'a pas pu démarrer/);
  // Une panne sans rapport ne doit pas être présentée comme un problème de virtualisation.
  assert.equal(wslStartFailureReason(new Error("EACCES: permission denied")), "");
  assert.equal(wslStartFailureReason(null), "");
});

test("a corrected provisioning script reaches a machine already installed", async () => {
  // L'image porte provision.sh : sans empreinte, une correction du script n'atteignait jamais
  // un environnement déjà en place, même après plusieurs builds.
  const build = backendBuild();
  try {
    const script = path.join(build.directory, "provision.sh");
    fs.writeFileSync(script, "#!/bin/sh\necho corrigé\n");
    const scriptId = createHash("sha256").update(fs.readFileSync(script)).digest("hex");
    const { calls, runner } = fakeEnvironment({
      distributions: ["SDK-Manager"],
      release: "0.6.0",
      backendId: build.id,
      provisionId: "ancienne-empreinte",
    });
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\\data\\wsl",
      mountPath: () => "/mnt/c/app/wsl/provision.sh",
    });

    await environment.prepare({
      version: "0.6.0",
      backendSource: build.directory,
      archive: "C:\\img.wsl",
      checksum: "C:\\img.wsl.sha256",
      provisionScript: script,
    });

    assert.ok(
      calls.some((call) => call.includes("install-provision")),
      "le script du build doit être copié",
    );
    assert.ok(calls.some((call) => call.includes("provision.sh") && call.includes("SDK_MANAGER_VERSION=0.6.0")));
    assert.ok(calls.some((call) => call.includes("write-provision-id") && call.includes(scriptId)));
    assert.ok(
      calls.every((call) => !call.includes("--from-file")),
      "la distribution ne doit pas être réimportée",
    );
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("an unchanged provisioning script is not replayed at every start", async () => {
  const build = backendBuild();
  try {
    const script = path.join(build.directory, "provision.sh");
    fs.writeFileSync(script, "#!/bin/sh\necho inchangé\n");
    const scriptId = createHash("sha256").update(fs.readFileSync(script)).digest("hex");
    const { calls, runner } = fakeEnvironment({
      distributions: ["SDK-Manager"],
      release: "0.6.0",
      backendId: build.id,
      provisionId: scriptId,
    });
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\\data\\wsl",
      mountPath: () => "/mnt/c/app/wsl/provision.sh",
    });

    await environment.prepare({
      version: "0.6.0",
      backendSource: build.directory,
      archive: "C:\\img.wsl",
      checksum: "C:\\img.wsl.sha256",
      provisionScript: script,
    });

    assert.ok(
      calls.every((call) => !call.includes("provision.sh")),
      "rien à refaire : aucun provisionnement",
    );
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("the legacy Windows projects folder is found even when settings were never saved", () => {
  // Cause des migrations absentes sur certains postes : sans config.json, aucun dossier n'était
  // transmis, et le gestionnaire ne proposait rien, sans le dire.
  const home = "C:\\Users\\benja";
  const only = (folder) => (candidate) => candidate === folder;

  assert.equal(
    legacyWindowsWorkspace({ configText: "", home, exists: only("C:\\Users\\benja\\Odoo-projects") }),
    "C:\\Users\\benja\\Odoo-projects",
  );
  // Même ordre que l'ancien backend : Documents\Developer d'abord.
  assert.equal(
    legacyWindowsWorkspace({ configText: "{}", home, exists: () => true }),
    "C:\\Users\\benja\\Documents\\Developer\\Odoo-projects",
  );
  assert.equal(
    legacyWindowsWorkspace({
      configText: '{"api_port": 18765}',
      home,
      exists: only("C:\\Users\\benja\\Documents\\Odoo-projects"),
    }),
    "C:\\Users\\benja\\Documents\\Odoo-projects",
  );
});

test("an explicitly configured legacy folder always wins", () => {
  assert.equal(
    legacyWindowsWorkspace({ configText: '{"workspace": "D:\\\\Odoo"}', home: "C:\\Users\\benja", exists: () => true }),
    "D:\\Odoo",
  );
});

test("no legacy folder is invented when nothing exists or the settings are unreadable", () => {
  assert.equal(legacyWindowsWorkspace({ configText: "", home: "C:\\Users\\benja", exists: () => false }), "");
  assert.equal(
    legacyWindowsWorkspace({
      configText: "{pas du json",
      home: "C:\\Users\\benja",
      exists: (candidate) => candidate.endsWith("\\Odoo-projects"),
    }),
    "C:\\Users\\benja\\Documents\\Developer\\Odoo-projects",
  );
  assert.equal(legacyWindowsWorkspace({ configText: "", home: "" }), "");
});

test("a legacy folder is seen from the distribution under /mnt", () => {
  assert.equal(
    WslEnvironment.mountedWindowsPath(
      legacyWindowsWorkspace({ configText: "", home: "C:\\Users\\benja", exists: () => true }),
    ),
    "/mnt/c/Users/benja/Documents/Developer/Odoo-projects",
  );
});

test("preparation announces its steps, in order, so the wait is never blind", async () => {
  const build = backendBuild();
  try {
    const { runner } = fakeEnvironment({ release: "", backendId: "aucun" });
    const steps = [];
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\\data\\wsl",
      mountPath: () => "/mnt/c/app/backend-linux",
      onProgress: (step) => steps.push(step),
    });
    const archive = path.join(build.directory, "image.wsl");
    fs.writeFileSync(archive, "image");
    fs.writeFileSync(archive + ".sha256", `${createHash("sha256").update("image").digest("hex")}  image.wsl\n`);

    await environment.prepare({
      version: "0.6.0",
      backendSource: build.directory,
      archive,
      checksum: archive + ".sha256",
    });

    assert.deepEqual(
      steps.map((step) => step.step),
      ["import", "backend", "provision", "done"],
    );
    assert.deepEqual(
      steps.map((step) => `${step.index}/${step.total}`),
      ["1/3", "2/3", "3/3", "3/3"],
    );
    assert.ok(steps.every((step) => step.label));
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("a partial preparation counts only the steps it will really run", async () => {
  const build = backendBuild();
  try {
    // Distribution à jour, backend identique : seul le provisionnement reste à faire.
    const { runner } = fakeEnvironment({ distributions: ["SDK-Manager"], release: "0.5.0", backendId: build.id });
    const steps = [];
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\\data\\wsl",
      mountPath: () => "/mnt/c/app/backend-linux",
      onProgress: (step) => steps.push(step),
    });

    await environment.prepare({
      version: "0.6.0",
      backendSource: build.directory,
      archive: "C:\\img.wsl",
      checksum: "C:\\img.wsl.sha256",
    });

    assert.deepEqual(
      steps.map((step) => `${step.step} ${step.index}/${step.total}`),
      ["provision 1/1", "done 1/1"],
    );
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("a new application version reprovisions without touching the projects", async () => {
  const build = backendBuild();
  try {
    const { calls, runner } = fakeEnvironment({
      distributions: ["SDK-Manager"],
      release: "0.4.0",
      backendId: build.id,
    });
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\\data\\wsl",
      mountPath: () => "/mnt/c/app/backend-linux",
    });

    await environment.prepare({
      version: "0.5.0",
      backendSource: build.directory,
      archive: "C:\\img.wsl",
      checksum: "C:\\img.wsl.sha256",
    });

    assert.ok(
      calls.every((call) => !call.includes("--from-file")),
      "la distribution ne doit jamais être réimportée",
    );
    assert.ok(calls.some((call) => call.includes("provision.sh") && call.includes("SDK_MANAGER_VERSION=0.5.0")));
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("the backend is copied as a whole folder and swapped in one step", async () => {
  const build = backendBuild();
  try {
    const { calls, runner } = fakeEnvironment();
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\\data\\wsl",
      mountPath: () => "/mnt/c/app/backend-linux",
    });

    await environment.installBackend(build.directory);

    const install = calls.find((call) => call.includes("install-backend"));
    assert.match(install, /cp -R "\$1"\/\. \/opt\/sdk-manager\/backend\.tmp\//);
    assert.match(install, /mv \/opt\/sdk-manager\/backend\.tmp \/opt\/sdk-manager\/backend/);
    assert.ok(install.includes("-u root"));
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("a backend outside any Windows drive is refused", async () => {
  const environment = new WslEnvironment({
    runner: fakeEnvironment().runner,
    installRoot: "C:\\data\\wsl",
    mountPath: () => "",
  });
  await assert.rejects(() => environment.installBackend("/somewhere"), /introuvable/);
});

test("the legacy Windows workspace is handed to the backend for migration", () => {
  const { args } = backendCommand({ port: 18765, legacyWorkspace: "/mnt/c/Users/a/Odoo-projects" });
  assert.ok(args.includes("ODOO_MANAGER_LEGACY_WORKSPACE=/mnt/c/Users/a/Odoo-projects"));
});

test("the Windows GitLab key is copied once, private to the environment user", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-ssh-"));
  try {
    fs.writeFileSync(path.join(directory, "id_rsa"), "rsa");
    fs.writeFileSync(path.join(directory, "id_rsa.pub"), "rsa.pub");
    fs.writeFileSync(path.join(directory, "id_ed25519"), "ed");
    fs.writeFileSync(path.join(directory, "id_ed25519.pub"), "ed.pub");
    const { calls, runner } = fakeEnvironment();
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\data\wsl",
      mountPath: (file) => "/mnt/c/Users/a/.ssh/" + path.basename(file),
    });

    const result = await environment.importSshKey(directory);

    assert.equal(result.key, "id_ed25519", "la clé préférée de ssh-keygen passe en premier");
    const command = calls.find((call) => call.includes("import-ssh-key"));
    assert.ok(command.includes("-u root"));
    assert.ok(command.includes('install -m 0600 -o sdk -g sdk "$1" "/home/sdk/.ssh/$3"'));
    assert.ok(command.includes("exit 3"), "une clé existante ne doit jamais être écrasée");
    assert.ok(command.endsWith("/mnt/c/Users/a/.ssh/id_ed25519 /mnt/c/Users/a/.ssh/id_ed25519.pub id_ed25519"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a half key pair is not imported", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-ssh-"));
  try {
    fs.writeFileSync(path.join(directory, "id_ed25519.pub"), "ed.pub");
    const environment = new WslEnvironment({
      runner: fakeEnvironment().runner,
      installRoot: "C:\data\wsl",
      mountPath: (file) => file,
    });
    await assert.rejects(() => environment.importSshKey(directory), /Aucune paire de clés/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("importing the same key twice confirms it instead of failing", async () => {
  // Cas rencontré en recette : l'assistant proposait encore le bouton, la clé était déjà copiée.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-ssh-"));
  try {
    fs.writeFileSync(path.join(directory, "id_ed25519"), "ed");
    fs.writeFileSync(path.join(directory, "id_ed25519.pub"), "ed.pub");
    const runner = async (_executable, args) => ({
      stdout: Buffer.from(args.includes("import-ssh-key") ? "already\n" : ""),
      stderr: Buffer.alloc(0),
      code: 0,
    });
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\data\wsl",
      mountPath: (file) => "/mnt/c/k/" + path.basename(file),
    });

    const result = await environment.importSshKey(directory);

    assert.deepEqual(result, { ok: true, key: "id_ed25519", alreadyPresent: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a different key already in the environment is never replaced", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-ssh-"));
  try {
    fs.writeFileSync(path.join(directory, "id_ed25519"), "ed");
    fs.writeFileSync(path.join(directory, "id_ed25519.pub"), "ed.pub");
    const { calls, runner } = fakeEnvironment();
    const environment = new WslEnvironment({
      runner,
      installRoot: "C:\data\wsl",
      mountPath: (file) => "/mnt/c/k/" + path.basename(file),
    });
    await environment.importSshKey(directory);
    const script = calls.find((call) => call.includes("import-ssh-key"));
    assert.ok(script.includes('cmp -s "$1" "/home/sdk/.ssh/$3"'));
    assert.ok(script.includes("n'est pas remplacée") && script.includes("exit 3"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
