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
  mergeWslConfig,
  parseWslSize,
  wslResourcesRequest,
  commandError,
  decodeWslOutput,
  expectedChecksum,
  imageFiles,
  importArguments,
  parseDistributions,
  parseVirtualization,
  isVirtualizationError,
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
  running = [],
  virtualization = "",
  fail = () => null,
} = {}) {
  const calls = [];
  const runner = async (executable, args) => {
    const call = [executable, ...args].join(" ");
    calls.push(call);
    const failure = fail(call, calls);
    if (failure) throw failure;
    if (executable === "powershell.exe" && call.includes("VirtualizationFirmwareEnabled")) {
      return { stdout: Buffer.from(virtualization), stderr: "", code: 0 };
    }
    if (args.includes("--running")) return { stdout: utf16(running.join("\r\n") + "\r\n"), stderr: "", code: 0 };
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
  const environment = new WslEnvironment({
    runner,
    installRoot: "C:\\data\\wsl",
    memory: () => ({ total: 16, free: 8 }),
  });

  assert.deepEqual(await environment.status(), {
    wslInstalled: true,
    wslVersion: "2.4.12.0",
    supportsFileImport: true,
    distribution: "SDK-Manager",
    distributionInstalled: true,
    release: "0.5.0",
    virtualization: "unknown",
    memory: { total: 16, free: 8 },
    preparing: false,
    progress: null,
  });
  assert.ok(calls.every((call) => !call.includes("--install")));
  assert.ok(
    calls.every((call) => !call.startsWith("powershell.exe")),
    "une distribution installée ne relit pas la virtualisation",
  );
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

test("the backend learns the Windows computer's memory and processors", () => {
  const { args } = backendCommand({ port: 18765, hostMemory: 34359738368, hostCpus: 12 });
  assert.ok(args.includes("ODOO_MANAGER_HOST_MEMORY=34359738368"));
  assert.ok(args.includes("ODOO_MANAGER_HOST_CPUS=12"));
  assert.equal(args.at(-1), BACKEND_PATH);
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

test("a silent failure says how the command stopped, not the whole script", () => {
  const script = 'set -eu\nmkdir -p /opt/sdk-manager\ncp -- "$1" /opt/sdk-manager/provision.sh.tmp';
  const cmd = `wsl.exe -d SDK-Manager -u root --exec sh -c ${script}`;
  const exited = commandError(
    "wsl.exe",
    Object.assign(new Error(`Command failed: ${cmd}\n`), { code: 1, cmd }),
    Buffer.alloc(0),
    Buffer.alloc(0),
  );
  assert.equal(exited.message, "wsl.exe s'est arrêté sans message (code 1).");
  assert.equal(exited.command, cmd);
  const killed = commandError(
    "wsl.exe",
    Object.assign(new Error("Command failed"), { code: null, killed: true, signal: "SIGTERM", cmd }),
    Buffer.alloc(0),
    Buffer.alloc(0),
  );
  assert.equal(killed.message, "wsl.exe n'a pas répondu dans le délai imparti.");
  const explained = commandError(
    "wsl.exe",
    Object.assign(new Error("Command failed"), { code: 1, cmd }),
    Buffer.alloc(0),
    Buffer.from("cp: can't stat '/mnt/c/x'\n"),
  );
  assert.equal(explained.message, "cp: can't stat '/mnt/c/x'");
});

// Échec silencieux de wsl.exe, tel que le runner le produit : la commande est connue.
const silentFailure = () =>
  Object.assign(new Error("wsl.exe s'est arrêté sans message (code 1)."), { command: "wsl.exe -d SDK-Manager" });

async function preparedWith(environmentOptions, prepareOptions = {}) {
  const build = backendBuild();
  const script = path.join(build.directory, "provision.sh");
  fs.writeFileSync(script, "#!/bin/sh\n");
  const logs = [];
  const fake = fakeEnvironment({ distributions: ["SDK-Manager"], release: "0.5.0", ...environmentOptions });
  const environment = new WslEnvironment({
    runner: fake.runner,
    installRoot: "C:\\data\\wsl",
    mountPath: () => "/mnt/c/Program Files/SDK Local Manager/resources/wsl/provision.sh",
    log: (line) => logs.push(line),
    sleep: async () => {},
  });
  const run = () =>
    environment.prepare({
      version: "0.6.0",
      backendSource: build.directory,
      archive: "C:\\img.wsl",
      checksum: "C:\\img.wsl.sha256",
      provisionScript: script,
      ...prepareOptions,
    });
  return {
    ...fake,
    logs,
    environment,
    run,
    cleanup: () => fs.rmSync(build.directory, { recursive: true, force: true }),
  };
}

test("a step stopped silently is replayed after restarting the distribution", async () => {
  // Cas réel : la copie du script s'arrêtait sans message et l'écran affichait la commande.
  const context = await preparedWith({
    fail: (call, calls) =>
      call.includes("install-provision") && calls.filter((c) => c.includes("install-provision")).length === 1
        ? silentFailure()
        : null,
  });
  try {
    await context.run();
    assert.ok(context.calls.includes("wsl.exe --terminate SDK-Manager"));
    assert.ok(context.calls.every((call) => !call.includes("--shutdown")));
    assert.equal(context.calls.filter((call) => call.includes("install-provision")).length, 2);
    assert.ok(context.calls.some((call) => call.includes("SDK_MANAGER_VERSION=0.6.0")));
    assert.ok(context.logs.some((line) => line.includes("nouvel essai")));
  } finally {
    context.cleanup();
  }
});

test("a step that keeps failing restarts WSL once, then names the step in the log", async () => {
  const context = await preparedWith({ fail: (call) => (call.includes("install-provision") ? silentFailure() : null) });
  try {
    await assert.rejects(
      context.run(),
      (error) =>
        error.step === "provision" &&
        error.message ===
          "La préparation s'est arrêtée à l'étape « Configuration de Docker et Git » après plusieurs essais." &&
        /sans message/.test(error.cause.message),
    );
    assert.ok(context.calls.includes("wsl.exe --terminate SDK-Manager"));
    assert.ok(context.calls.includes("wsl.exe --shutdown"));
    assert.equal(context.calls.filter((call) => call.includes("install-provision")).length, 3);
    assert.ok(context.logs.some((line) => line.includes("Configuration de Docker et Git") && line.includes("code 1")));
    assert.ok(context.logs.some((line) => line.includes("Commande : wsl.exe -d SDK-Manager")));
  } finally {
    context.cleanup();
  }
});

test("WSL is never shut down while another distribution is running", async () => {
  const context = await preparedWith({
    running: ["SDK-Manager", "docker-desktop"],
    fail: (call) => (call.includes("install-provision") ? silentFailure() : null),
  });
  try {
    await assert.rejects(context.run());
    assert.ok(context.calls.every((call) => !call.includes("--shutdown")));
    assert.ok(context.logs.some((line) => line.includes("docker-desktop")));
  } finally {
    context.cleanup();
  }
});

test("the distribution is not restarted while the backend runs in it", async () => {
  const context = await preparedWith(
    {
      fail: (call, calls) =>
        call.includes("install-provision") && calls.filter((c) => c.includes("install-provision")).length === 1
          ? silentFailure()
          : null,
    },
    { restartAllowed: false },
  );
  try {
    await context.run();
    assert.ok(context.calls.every((call) => !call.includes("--terminate") && !call.includes("--shutdown")));
    const copies = context.calls.filter((call) => call.includes("install-provision") && !call.includes("pkill"));
    assert.equal(copies.length, 2);
    // Linux tourne toujours : les restes du premier essai sont arrêtés avant le second.
    const cleanup = context.calls.findIndex((call) => call.includes("-u root --exec pkill -f --"));
    assert.ok(cleanup > context.calls.indexOf(copies[0]) && cleanup < context.calls.lastIndexOf(copies[1]));
  } finally {
    context.cleanup();
  }
});

test("a Linux stuck while starting is restarted before anything else", async () => {
  // Délai dépassé sur le premier démarrage : sans délai court, chaque lecture attendait 10 minutes.
  const context = await preparedWith({
    fail: (call, calls) =>
      call.endsWith("--exec true") && calls.filter((c) => c.endsWith("--exec true")).length === 1
        ? Object.assign(new Error("wsl.exe n'a pas répondu dans le délai imparti."), { command: call })
        : null,
  });
  try {
    await context.run();
    const terminate = context.calls.indexOf("wsl.exe --terminate SDK-Manager");
    const firstStep = context.calls.findIndex((call) => call.includes("install-provision"));
    assert.ok(terminate >= 0 && terminate < firstStep);
  } finally {
    context.cleanup();
  }
});

test("two preparations at once share a single run", async () => {
  // Le démarrage de l'application et le clic sur « Préparer mon poste » se chevauchaient.
  const context = await preparedWith({});
  try {
    const [first, second] = await Promise.all([context.run(), context.run()]);
    assert.deepEqual(first, second);
    assert.equal(context.calls.filter((call) => call.includes("install-provision")).length, 1);
    await context.run();
    assert.equal(
      context.calls.filter((call) => call.includes("install-provision")).length,
      2,
      "une fois terminée, une préparation se relance",
    );
  } finally {
    context.cleanup();
  }
});

test("a failure that is not a command is not replayed", async () => {
  const context = await preparedWith({}, { backendSource: path.join(os.tmpdir(), "absent-backend") });
  try {
    await assert.rejects(context.run(), /ENOENT/);
    assert.ok(context.calls.every((call) => !call.includes("--terminate")));
  } finally {
    context.cleanup();
  }
});

test("an interrupted import is cleaned up before the next attempt", async () => {
  const build = backendBuild();
  const archive = path.join(build.directory, "image.wsl");
  fs.writeFileSync(archive, "image");
  fs.writeFileSync(archive + ".sha256", createHash("sha256").update("image").digest("hex") + "\n");
  const distributions = [];
  const { calls, runner } = fakeEnvironment({
    distributions,
    fail: (call, all) => {
      if (call.includes("--from-file")) {
        distributions.splice(0, distributions.length, "SDK-Manager");
        if (all.filter((c) => c.includes("--from-file")).length === 1) return silentFailure();
      }
      return null;
    },
  });
  const environment = new WslEnvironment({
    runner,
    installRoot: path.join(build.directory, "wsl"),
    mountPath: () => "/mnt/c/app",
    sleep: async () => {},
  });
  try {
    await environment.prepare({
      version: "0.6.0",
      backendSource: build.directory,
      archive,
      checksum: archive + ".sha256",
    });
    const unregister = calls.indexOf("wsl.exe --unregister SDK-Manager");
    const imports = calls.map((call, index) => (call.includes("--from-file") ? index : -1)).filter((i) => i >= 0);
    assert.equal(imports.length, 2);
    assert.ok(unregister > imports[0] && unregister < imports[1]);
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

function imageIn(directory) {
  const archive = path.join(directory, "image.wsl");
  fs.writeFileSync(archive, "image");
  fs.writeFileSync(archive + ".sha256", createHash("sha256").update("image").digest("hex") + "\n");
  return { archive, checksum: archive + ".sha256" };
}

test("an environment hidden by a failed list is never replaced", async () => {
  // `wsl --list` en échec passager : la préparation croyait l'environnement absent. Désinscrire
  // ce qu'elle trouvait ensuite aurait effacé les projets de l'utilisateur.
  const build = backendBuild();
  const { calls, runner } = fakeEnvironment({
    distributions: ["SDK-Manager"],
    fail: (call, all) =>
      call === "wsl.exe --list --quiet" && all.filter((c) => c === call).length === 1 ? new Error("illisible") : null,
  });
  const environment = new WslEnvironment({
    runner,
    installRoot: path.join(build.directory, "wsl"),
    mountPath: () => "/mnt/c/app",
    sleep: async () => {},
  });
  try {
    await environment.prepare({ version: "0.6.0", backendSource: build.directory, ...imageIn(build.directory) });
    assert.ok(calls.every((call) => !call.includes("--unregister") && !call.includes("--from-file")));
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("the disk of an interrupted import is set aside, never deleted", async () => {
  const build = backendBuild();
  const installRoot = path.join(build.directory, "wsl");
  fs.mkdirSync(installRoot);
  fs.writeFileSync(path.join(installRoot, "ext4.vhdx"), "ancien disque");
  const { calls, runner } = fakeEnvironment({ distributions: [] });
  const environment = new WslEnvironment({ runner, installRoot, mountPath: () => "/mnt/c/app", sleep: async () => {} });
  try {
    await environment.prepare({ version: "0.6.0", backendSource: build.directory, ...imageIn(build.directory) });
    const kept = fs.readdirSync(installRoot).filter((name) => name.startsWith("ext4.vhdx.interrompu-"));
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(installRoot, kept[0]), "utf8"), "ancien disque");
    assert.ok(calls.some((call) => call.includes("--from-file")));
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("a Linux that never starts is named in the log", async () => {
  const context = await preparedWith({
    fail: (call) =>
      call.endsWith("--exec true")
        ? Object.assign(new Error("wsl.exe n'a pas répondu dans le délai imparti."), { command: call })
        : null,
  });
  try {
    await assert.rejects(context.run(), /étape « Démarrage de l'environnement Linux » après plusieurs essais/);
    assert.ok(
      context.logs.some((line) => line.includes("Démarrage de l'environnement Linux") && line.includes("Échec")),
    );
  } finally {
    context.cleanup();
  }
});

test("virtualization is read from the processor, or from a hypervisor that hides it", () => {
  assert.equal(parseVirtualization('{"hypervisor":false,"firmware":[true]}'), "enabled");
  // Hyper-V ou WSL déjà actif : le processeur répond faux, l'hyperviseur prouve qu'elle est active.
  assert.equal(parseVirtualization('{"hypervisor":true,"firmware":[false]}'), "enabled");
  assert.equal(parseVirtualization('{"hypervisor":false,"firmware":[false,false]}'), "disabled");
  assert.equal(parseVirtualization('{"hypervisor":false,"firmware":false}'), "disabled");
  // Réponse incomplète : jamais bloquant.
  assert.equal(parseVirtualization('{"hypervisor":false,"firmware":[null]}'), "unknown");
  assert.equal(parseVirtualization('{"hypervisor":false,"firmware":[]}'), "unknown");
  assert.equal(parseVirtualization(""), "unknown");
  assert.equal(parseVirtualization(utf16('{"hypervisor":true,"firmware":[]}')), "enabled");
});

test("Windows virtualization errors are recognised in French and English", () => {
  assert.ok(isVirtualizationError(new Error("Erreur : 0x80370102")));
  assert.ok(isVirtualizationError(new Error("Please ensure virtualization is enabled in the BIOS.")));
  assert.ok(isVirtualizationError(new Error("Vérifiez que la virtualisation est activée dans le BIOS.")));
  assert.ok(!isVirtualizationError(new Error("cp: can't stat")));
});

test("disabled virtualization stops the preparation before the import", async () => {
  const build = backendBuild();
  const logs = [];
  const { calls, runner } = fakeEnvironment({ virtualization: '{"hypervisor":false,"firmware":[false]}' });
  const environment = new WslEnvironment({
    runner,
    installRoot: path.join(build.directory, "wsl"),
    mountPath: () => "/mnt/c/app",
    log: (line) => logs.push(line),
    sleep: async () => {},
  });
  try {
    assert.equal((await environment.status()).virtualization, "disabled");
    await assert.rejects(
      environment.prepare({ version: "0.6.0", backendSource: build.directory, ...imageIn(build.directory) }),
      /virtualisation est désactivée/,
    );
    assert.ok(calls.every((call) => !call.includes("--from-file")));
    assert.ok(logs.some((line) => line.includes("virtualisation")));
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("enabled virtualization is read once", async () => {
  const { calls, runner } = fakeEnvironment({ virtualization: '{"hypervisor":true,"firmware":[false]}' });
  const environment = new WslEnvironment({ runner, installRoot: "C:\\data\\wsl" });
  assert.equal(await environment.virtualization(), "enabled");
  assert.equal(await environment.virtualization(), "enabled");
  assert.equal(calls.filter((call) => call.startsWith("powershell.exe")).length, 1);
});

test("a virtualization failure from Windows is not replayed", async () => {
  const build = backendBuild();
  const { calls, runner } = fakeEnvironment({
    fail: (call) =>
      call.includes("--from-file")
        ? Object.assign(new Error("Wsl/Service/CreateInstance/0x80370102"), { command: call })
        : null,
  });
  const environment = new WslEnvironment({
    runner,
    installRoot: path.join(build.directory, "wsl"),
    mountPath: () => "/mnt/c/app",
    sleep: async () => {},
  });
  try {
    await assert.rejects(
      environment.prepare({ version: "0.6.0", backendSource: build.directory, ...imageIn(build.directory) }),
      /0x80370102/,
    );
    assert.equal(calls.filter((call) => call.includes("--from-file")).length, 1);
    assert.ok(calls.every((call) => !call.includes("--terminate") && !call.includes("--shutdown")));
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("the screen is told about a new attempt, and can join a preparation already running", async () => {
  const progress = [];
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  const context = await preparedWith({
    fail: (call, calls) =>
      call.includes("install-provision") && calls.filter((c) => c.includes("install-provision")).length === 1
        ? silentFailure()
        : null,
  });
  context.environment.onProgress = (step) => progress.push(step);
  const runner = context.environment.run;
  // La copie du backend attend : la préparation est observée pendant qu'elle tourne.
  context.environment.run = async (executable, args, options) => {
    if (args.includes("install-backend")) await blocked;
    return runner(executable, args, options);
  };
  try {
    const running = context.run();
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 50 && !context.environment.preparation().progress; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(context.environment.preparation(), {
      preparing: true,
      progress: { step: "backend", label: "Copie du gestionnaire", index: 1, total: 2 },
    });
    release();
    await running;
    assert.ok(
      progress.some((step) => step.step === "provision" && step.retry === 1 && /^Nouvel essai/.test(step.label)),
    );
    assert.deepEqual(context.environment.preparation(), { preparing: false, progress: null });
  } finally {
    context.cleanup();
  }
});

test("set-aside disks are removed 14 days after a successful preparation", async () => {
  const build = backendBuild();
  const installRoot = path.join(build.directory, "wsl");
  fs.mkdirSync(installRoot);
  const now = Date.UTC(2026, 9, 8);
  const old = `ext4.vhdx.interrompu-${now - 15 * 24 * 3600_000}`;
  const recent = `ext4.vhdx.interrompu-${now - 2 * 24 * 3600_000}`;
  for (const name of [old, recent]) fs.writeFileSync(path.join(installRoot, name), "disque");
  const { runner } = fakeEnvironment({ distributions: ["SDK-Manager"], release: "0.5.0" });
  const environment = new WslEnvironment({
    runner,
    installRoot,
    mountPath: () => "/mnt/c/app",
    sleep: async () => {},
    now: () => now,
  });
  try {
    await environment.prepare({ version: "0.6.0", backendSource: build.directory });
    assert.deepEqual(fs.readdirSync(installRoot), [recent]);
  } finally {
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test("low free memory is written to the log before preparing", async () => {
  const context = await preparedWith({});
  context.environment.memory = () => ({ total: 8 * 1024 ** 3, free: 512 * 1024 ** 2 });
  try {
    await context.run();
    assert.ok(context.logs.some((line) => line.includes("Peu de mémoire libre") && line.includes("512 Mo")));
  } finally {
    context.cleanup();
  }
});

const GIB = 1024 ** 3;
const RESOURCES = { memory: 20 * GIB, cpus: 10, swap: 4 * GIB };

test(".wslconfig is created with the recommended resources", () => {
  assert.equal(mergeWslConfig("", RESOURCES), "[wsl2]\r\nmemory=20GB\r\nprocessors=10\r\nswap=4GB\r\n");
});

test(".wslconfig keeps other settings and never lowers a larger value", () => {
  const original = [
    "# réglages perso",
    "[wsl2]",
    "memory = 24GB",
    "processors=4 # limité",
    "networkingMode=mirrored",
    "",
    "[experimental]",
    "autoMemoryReclaim=gradual",
    "",
  ].join("\n");
  assert.equal(
    mergeWslConfig(original, RESOURCES),
    [
      "# réglages perso",
      "[wsl2]",
      "memory = 24GB",
      "processors=10",
      "networkingMode=mirrored",
      "swap=4GB",
      "",
      "[experimental]",
      "autoMemoryReclaim=gradual",
      "",
    ].join("\r\n"),
  );
});

test(".wslconfig without a [wsl2] section gets one at the end", () => {
  assert.equal(
    mergeWslConfig("[experimental]\nsparseVhd=true\n", RESOURCES),
    "[experimental]\r\nsparseVhd=true\r\n\r\n[wsl2]\r\nmemory=20GB\r\nprocessors=10\r\nswap=4GB\r\n",
  );
});

test("WSL sizes are read with or without the B", () => {
  assert.equal(parseWslSize("8GB"), 8 * GIB);
  assert.equal(parseWslSize("8192MB"), 8 * GIB);
  assert.equal(parseWslSize("8g"), 8 * GIB);
  assert.equal(parseWslSize("beaucoup"), 0);
});

test("requested resources never exceed the computer", () => {
  const computer = { totalMemory: 32 * GIB, cpuCount: 12 };
  assert.deepEqual(wslResourcesRequest(RESOURCES, computer), RESOURCES);
  assert.throws(() => wslResourcesRequest({ ...RESOURCES, memory: 40 * GIB }, computer), /Mémoire/);
  assert.throws(() => wslResourcesRequest({ ...RESOURCES, memory: 1.5 * GIB }, computer), /Mémoire/);
  assert.throws(() => wslResourcesRequest({ ...RESOURCES, cpus: 16 }, computer), /processeurs/);
  assert.throws(() => wslResourcesRequest({ ...RESOURCES, swap: "4GB" }, computer), /Swap/);
});

test("writing the resources keeps a copy of the original .wslconfig", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-wslconfig-"));
  try {
    const file = path.join(directory, ".wslconfig");
    fs.writeFileSync(file, "[wsl2]\nmemory=8GB\n");
    const environment = new WslEnvironment({ installRoot: directory });
    assert.equal(environment.writeResources(RESOURCES, file), true);
    assert.equal(fs.readFileSync(file, "utf8"), "[wsl2]\r\nmemory=20GB\r\nprocessors=10\r\nswap=4GB\r\n");
    assert.equal(fs.readFileSync(file + ".sdk-manager.bak", "utf8"), "[wsl2]\nmemory=8GB\n");
    // Déjà réglé : rien n'est réécrit.
    assert.equal(environment.writeResources(RESOURCES, file), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
