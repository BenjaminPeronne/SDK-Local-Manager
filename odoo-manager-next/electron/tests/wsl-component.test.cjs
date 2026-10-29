// Composant Windows « Sous-système Windows pour Linux » inactif : cas rencontré sur un poste où
// l'activation de WSL rendait 0 sans redémarrage. L'application enchaînait sur l'import, chaque
// commande échouait sur Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED, était rejouée deux fois, puis
// l'écran parlait d'un échec « après plusieurs essais » au lieu de demander le redémarrage.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  ENABLE_WSL_SCRIPT,
  WslEnvironment,
  decodeWslOutput,
  elevatedCommand,
  isComponentError,
  wslStartFailureReason,
} = require("../wsl.cjs");

const utf16 = (text) => Buffer.from(text, "utf16le");
const empty = () => ({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), code: 0 });

// Sortie réelle de wsl.exe, en UTF-16 comme dans un tube.
const COMPONENT_OUTPUT = utf16(
  "Cette application nécessite le composant facultatif Sous-système Windows pour Linux.\r\n" +
    "Installez-le en exécutant : wsl.exe --install --no-distribution\r\n" +
    "Le système devra peut-être être redémarré pour que les modifications prennent effet.\r\n" +
    "Code d’erreur : Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED\r\n",
);

const componentFailure = (command) => Object.assign(new Error(decodeWslOutput(COMPONENT_OUTPUT).trim()), { command });

/**
 * Poste Windows simulé. `componentMissing` vaut avant l'activation, `componentAfterInstall` après.
 *
 * Comme `defaultRunner` : avec `allowFailure`, la sortie et le code reviennent ; sans, l'échec
 * est levé avec la commande.
 */
function machine({
  componentMissing = true,
  componentAfterInstall = componentMissing,
  rebootPending = false,
  installCode = 0,
  installError = "",
  version = "2.6.1.0",
  distributions = [],
  fail = () => null,
} = {}) {
  const calls = [];
  const activationTimeouts = [];
  let activated = false;
  const runner = async (executable, args, options = {}) => {
    const call = [executable, ...args].join(" ");
    calls.push(call);
    if (executable === "powershell.exe") {
      if (call.includes("-EncodedCommand")) {
        activated = true;
        activationTimeouts.push(options.timeout);
        return { ...empty(), stderr: Buffer.from(installError), code: installCode };
      }
      if (call.includes("RebootPending")) {
        return { ...empty(), stdout: Buffer.from(rebootPending ? "True\r\n" : "False\r\n") };
      }
      if (call.includes("VirtualizationFirmwareEnabled")) {
        return { ...empty(), stdout: Buffer.from('{"hypervisor":true,"firmware":[true]}') };
      }
      return empty();
    }
    if (args.includes("--version")) {
      if (!version) throw Object.assign(new Error("wsl.exe introuvable"), { command: call });
      return { ...empty(), stdout: utf16(`Version WSL : ${version}\r\n`) };
    }
    const failure = fail(call, calls);
    if (failure) throw failure;
    if (activated ? componentAfterInstall : componentMissing) {
      if (options.allowFailure) return { ...empty(), stdout: COMPONENT_OUTPUT, code: 1 };
      throw componentFailure(call);
    }
    if (args.includes("--list")) return { ...empty(), stdout: utf16(distributions.join("\r\n") + "\r\n") };
    return empty();
  };
  return { calls, activationTimeouts, runner };
}

function environment(fake, extra = {}) {
  const logs = [];
  const wsl = new WslEnvironment({
    runner: fake.runner,
    installRoot: "C:\\data\\wsl",
    log: (line) => logs.push(line),
    sleep: async () => {},
    memory: () => ({ total: 16 * 1024 ** 3, free: 8 * 1024 ** 3 }),
    ...extra,
  });
  return { wsl, logs };
}

function buildWithImage() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-component-"));
  fs.writeFileSync(path.join(directory, "odoo-manager-backend"), "ELF backend");
  const archive = path.join(directory, "image.wsl");
  fs.writeFileSync(archive, "image");
  fs.writeFileSync(archive + ".sha256", createHash("sha256").update("image").digest("hex") + "\n");
  return {
    directory,
    options: { version: "0.6.0", backendSource: directory, archive, checksum: archive + ".sha256" },
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

test("the Windows component error is recognised by its code", () => {
  assert.ok(isComponentError(componentFailure("wsl.exe --list --quiet")));
  assert.ok(isComponentError("Code d'erreur : Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED"));
  assert.ok(!isComponentError(new Error("Wsl/Service/CreateInstance/0x8007019e")));
  assert.ok(!isComponentError(null));
});

test("a WSL package without its Windows component is not reported as installed", async () => {
  // `wsl --version` répond : c'est ce qui faisait croire WSL installé au second lancement.
  const { wsl } = environment(machine({ componentMissing: true }));
  const status = await wsl.status();
  assert.equal(status.wslVersion, "2.6.1.0");
  assert.equal(status.wslInstalled, false);
  assert.equal(status.wslComponentMissing, true);
  assert.equal(status.rebootPending, false);
  assert.equal(status.distributionInstalled, false);
});

test("a component waiting for the restart is reported as such", async () => {
  const { wsl } = environment(machine({ componentMissing: true, rebootPending: true }));
  const status = await wsl.status();
  assert.equal(status.wslComponentMissing, true);
  assert.equal(status.rebootPending, true);
});

test("a usable WSL adds nothing to the status and never reads the restart state", async () => {
  const fake = machine({ componentMissing: false, distributions: ["SDK-Manager"] });
  const { wsl } = environment(fake);
  const status = await wsl.status();
  assert.equal(status.wslInstalled, true);
  assert.equal(status.distributionInstalled, true);
  assert.ok(!("wslComponentMissing" in status));
  assert.ok(!("rebootPending" in status));
  assert.ok(fake.calls.every((call) => !call.includes("RebootPending")));
});

test("an activation that exits with 0 but leaves WSL unusable asks for the restart", async () => {
  // Cas réel : « Installation de WSL: code 0. » puis l'import échouait aussitôt.
  const fake = machine({ componentMissing: true, componentAfterInstall: true, installCode: 0 });
  const { wsl, logs } = environment(fake);
  const result = await wsl.installWsl();
  assert.equal(result.ok, true);
  assert.equal(result.rebootRequired, true);
  assert.match(result.message, /redémarre l'ordinateur/);
  assert.ok(logs.some((line) => line.includes("code 0") && line.includes("redémarrage")));
});

test("exit code 3010 means the restart is required, whatever WSL answers", async () => {
  const { wsl } = environment(machine({ componentMissing: true, componentAfterInstall: false, installCode: 3010 }));
  const result = await wsl.installWsl();
  assert.equal(result.ok, true);
  assert.equal(result.rebootRequired, true);
});

test("a restart already pending is detected even when WSL answers", async () => {
  const { wsl } = environment(
    machine({ componentMissing: true, componentAfterInstall: false, installCode: 0, rebootPending: true }),
  );
  assert.equal((await wsl.installWsl()).rebootRequired, true);
});

test("an activation that leaves WSL usable needs no restart", async () => {
  const { wsl } = environment(machine({ componentMissing: true, componentAfterInstall: false, installCode: 0 }));
  const result = await wsl.installWsl();
  assert.deepEqual(result, { ok: true, rebootRequired: false, message: "" });
});

test("a refused authorization installs nothing and does not ask for a restart", async () => {
  const fake = machine({ installCode: 1223 });
  const { wsl } = environment(fake);
  const result = await wsl.installWsl();
  assert.equal(result.ok, false);
  assert.equal(result.elevationRefused, true);
  assert.equal(result.rebootRequired, false);
  assert.match(result.message, /administrateur/);
  // Rien n'a été activé : l'état n'est pas relu pour inventer un redémarrage.
  assert.ok(fake.calls.every((call) => !call.includes("--list") && !call.includes("RebootPending")));
});

test("the journal keeps the real reason when the elevated window could not open", async () => {
  // 1223 couvre tout échec de `Start-Process` : le message de Windows départage le refus des autres causes.
  const { wsl, logs } = environment(
    machine({ installCode: 1223, installError: "L'opération a été annulée par l'utilisateur.\r\n" }),
  );
  await wsl.installWsl();
  assert.ok(
    logs.some((line) => line.includes("refusée") && line.includes("(L'opération a été annulée par l'utilisateur.)")),
  );
});

test("the activation is waited for long enough to download the WSL package", async () => {
  // Les 10 minutes par défaut arrêtaient la commande d'ici sur une connexion lente, et l'écran
  // annonçait un échec pendant que la fenêtre élevée continuait.
  const fake = machine({ componentMissing: true, componentAfterInstall: false });
  const { wsl } = environment(fake);
  await wsl.installWsl();
  assert.deepEqual(fake.activationTimeouts, [30 * 60_000]);
});

test("a failed activation is reported with its code, without asking for a restart", async () => {
  const { wsl } = environment(machine({ installCode: 87 }));
  const result = await wsl.installWsl();
  assert.equal(result.ok, false);
  assert.equal(result.rebootRequired, false);
  assert.match(result.message, /code 87/);
});

test("both Windows components and the WSL package are enabled under a single authorization", async () => {
  const fake = machine({ componentMissing: true, componentAfterInstall: false });
  const { wsl } = environment(fake);
  await wsl.installWsl();
  const elevated = fake.calls.filter((call) => call.includes("-Verb RunAs"));
  assert.equal(elevated.length, 1);
  const encoded = /'-EncodedCommand','([^']+)'/.exec(elevated[0])[1];
  const script = Buffer.from(encoded, "base64").toString("utf16le");
  assert.equal(script, ENABLE_WSL_SCRIPT);
  assert.match(script, /Microsoft-Windows-Subsystem-Linux/);
  assert.match(script, /VirtualMachinePlatform/);
  assert.match(script, /\/norestart/);
  assert.match(script, /wsl\.exe --install --no-distribution/);
  assert.match(script, /3010/);
});

test("the elevated command turns a refused authorization into 1223", () => {
  const command = elevatedCommand("exit 0");
  assert.match(command, /Start-Process -FilePath powershell\.exe -Verb RunAs -Wait -PassThru/);
  assert.match(command, /exit \$p\.ExitCode/);
  assert.match(command, /catch \{ \[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\); exit 1223 \}/);
  assert.ok(!command.includes('"'), "aucun guillemet double à échapper dans la ligne de commande");
});

test("a missing component stops the preparation before any import, without retries", async () => {
  const build = buildWithImage();
  const fake = machine({ componentMissing: true });
  const { wsl, logs } = environment(fake);
  try {
    await assert.rejects(wsl.prepare(build.options), /n'est pas encore actif : redémarre l'ordinateur/);
    assert.ok(fake.calls.every((call) => !call.includes("--from-file")));
    assert.ok(fake.calls.every((call) => !call.includes("--terminate") && !call.includes("--shutdown")));
    assert.ok(logs.every((line) => !line.includes("nouvel essai")));
  } finally {
    build.cleanup();
  }
});

test("a component error raised during a step is not replayed and asks for the restart", async () => {
  const build = buildWithImage();
  const fake = machine({
    componentMissing: false,
    fail: (call) => (call.includes("--from-file") ? componentFailure(call) : null),
  });
  const { wsl, logs } = environment(fake, { installRoot: path.join(build.directory, "wsl") });
  try {
    await assert.rejects(
      wsl.prepare(build.options),
      (error) =>
        /n'est pas encore actif : redémarre l'ordinateur/.test(error.message) &&
        error.step === "import" &&
        isComponentError(error.cause),
    );
    assert.equal(fake.calls.filter((call) => call.includes("--from-file")).length, 1);
    assert.ok(fake.calls.every((call) => !call.includes("--terminate") && !call.includes("--shutdown")));
    assert.ok(logs.some((line) => line.includes("Échec de l'étape « Installation de l'environnement Linux »")));
  } finally {
    build.cleanup();
  }
});

test("an environment that stops starting for lack of the component is explained", () => {
  assert.match(wslStartFailureReason(componentFailure("wsl.exe -d SDK-Manager")), /Redémarre l'ordinateur/);
});
