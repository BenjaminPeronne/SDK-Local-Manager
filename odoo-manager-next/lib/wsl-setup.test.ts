import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isWslSetupPending,
  memoryWarning,
  prepareProgressPercent,
  wslSetupError,
  wslSetupState,
  type WslStatus,
} from "./wsl-setup.ts";

const status = (overrides: Partial<WslStatus> = {}): WslStatus => ({
  wslInstalled: true,
  wslVersion: "2.4.12.0",
  supportsFileImport: true,
  distribution: "SDK-Manager",
  distributionInstalled: true,
  release: "0.5.0",
  ...overrides,
});

test("a prepared machine asks for nothing", () => {
  assert.equal(wslSetupState(status(), "0.5.0").step, "ready");
  assert.equal(isWslSetupPending(status(), "0.5.0"), false);
});

test("WSL is installed first, with a single elevation", () => {
  const state = wslSetupState(status({ wslInstalled: false, wslVersion: "" }), "0.5.0");
  assert.equal(state.step, "install-wsl");
  assert.equal(state.needsElevation, true);
});

test("a WSL too old to import a file is called out instead of failing later", () => {
  const state = wslSetupState(status({ supportsFileImport: false, wslVersion: "2.0.9" }), "0.5.0");
  assert.equal(state.step, "outdated-wsl");
  assert.match(state.detail, /2\.0\.9/);
});

test("the environment is installed in one click once WSL is there", () => {
  const state = wslSetupState(status({ distributionInstalled: false, release: "" }), "0.5.0");
  assert.equal(state.step, "install-environment");
  assert.equal(state.needsElevation, false);
});

test("an application update reprovisions the environment, never the projects", () => {
  const state = wslSetupState(status({ release: "0.4.0" }), "0.5.0");
  assert.equal(state.step, "update-environment");
  assert.match(state.detail, /pas touchés/);
});

test("a machine without the bridge is reported as unsupported, not broken", () => {
  assert.equal(wslSetupState(null, "0.5.0").step, "unsupported");
  assert.equal(isWslSetupPending(null, "0.5.0"), false);
});

test("a system without a Linux environment is never asked to install WSL", () => {
  const macOs = status({
    supported: false,
    wslInstalled: false,
    wslVersion: "",
    distributionInstalled: false,
    release: "",
  });
  assert.equal(wslSetupState(macOs, "0.5.0").step, "unsupported");
  assert.equal(isWslSetupPending(macOs, "0.5.0"), false);
});

test("failures are explained in terms the user can act on", () => {
  assert.match(
    wslSetupError(new Error("L'image ne correspond pas à son empreinte : installation refusée.")),
    /Retélécharge/,
  );
  assert.match(wslSetupError(new Error("ENOENT: no such file or directory")), /absente/);
  assert.match(wslSetupError(new Error("Erreur 0x80370102")), /virtualisation/i);
  assert.equal(wslSetupError(new Error("Échec inattendu")), "Échec inattendu");
  assert.match(wslSetupError(new Error("wsl.exe s'est arrêté sans message (code 1).")), /ouvre le journal/);
  assert.match(
    wslSetupError(new Error("Command failed: wsl.exe -d SDK-Manager -u root --exec sh -c set -eu")),
    /ouvre le journal/,
  );
  assert.match(wslSetupError(new Error("wsl.exe n'a pas répondu dans le délai imparti.")), /Redémarre/);
});

test("Electron's technical wrapper is removed from native errors", () => {
  const wrapped = new Error("Error invoking remote method 'sdk:wsl-prepare': Error: Échec inattendu");
  assert.equal(wslSetupError(wrapped), "Échec inattendu");
});

test("the preparation bar is one continuous percentage that never goes back", () => {
  const first = (step: string, index: number) => ({ step, index, total: 3 });
  assert.equal(prepareProgressPercent(null, 0), 0);
  assert.equal(prepareProgressPercent(first("import", 1), 0), 0);
  const duringImport = prepareProgressPercent(first("import", 1), 60);
  const lateImport = prepareProgressPercent(first("import", 1), 900);
  const backend = prepareProgressPercent(first("backend", 2), 0);
  assert.ok(duringImport > 0 && duringImport < lateImport);
  assert.ok(lateImport < backend, "une étape trop longue reste sous le début de la suivante");
  assert.ok(prepareProgressPercent(first("provision", 3), 10_000) <= 99);
  assert.equal(prepareProgressPercent(first("done", 3), 0), 100);
});

test("an update without import spreads the bar over the remaining steps", () => {
  assert.equal(prepareProgressPercent({ step: "backend", index: 1, total: 2 }, 0), 0);
  assert.ok(prepareProgressPercent({ step: "provision", index: 2, total: 2 }, 0) > 0);
  assert.equal(prepareProgressPercent({ step: "provision", index: 1, total: 1 }, 0), 0);
});

test("disabled virtualization is announced before anything is installed", () => {
  const base = {
    wslInstalled: true,
    wslVersion: "2.6.1.0",
    supportsFileImport: true,
    distribution: "SDK-Manager",
    distributionInstalled: false,
    release: "",
  };
  const blocked = wslSetupState({ ...base, virtualization: "disabled" }, "0.6.0");
  assert.equal(blocked.step, "virtualization-disabled");
  assert.match(blocked.detail, /BIOS/);
  assert.equal(
    wslSetupState({ ...base, wslInstalled: false, virtualization: "disabled" }, "0.6.0").step,
    "virtualization-disabled",
  );
  // Une réponse floue ne bloque jamais.
  assert.equal(wslSetupState({ ...base, virtualization: "unknown" }, "0.6.0").step, "install-environment");
  assert.equal(wslSetupState(base, "0.6.0").step, "install-environment");
  // Un environnement déjà installé n'est pas concerné : sa bascule a son propre message.
  assert.equal(
    wslSetupState({ ...base, distributionInstalled: true, release: "0.6.0", virtualization: "disabled" }, "0.6.0").step,
    "ready",
  );
  assert.equal(isWslSetupPending({ ...base, virtualization: "disabled" }, "0.6.0"), true);
});

test("the English virtualization error is explained too", () => {
  assert.match(
    wslSetupError(
      new Error("Please enable the Virtual Machine Platform and ensure virtualization is enabled in the BIOS."),
    ),
    /virtualisation est désactivée/,
  );
});

test("a step that failed after retries tells the user what to do", () => {
  const message = wslSetupError(
    new Error(
      "Error invoking remote method 'sdk:wsl-prepare': Error: La préparation s'est arrêtée à l'étape « Copie du gestionnaire » après plusieurs essais.",
    ),
  );
  assert.match(message, /^La préparation s'est arrêtée à l'étape « Copie du gestionnaire »/);
  assert.match(message, /Redémarre l'ordinateur/);
  assert.match(message, /ouvre le journal/);
  assert.match(
    wslSetupError(new Error("EPERM: operation not permitted, rename 'C:\\x'")),
    /^La préparation a échoué\./,
  );
});

test("low memory is announced before installing, never after", () => {
  const base = {
    wslInstalled: true,
    wslVersion: "2.6.1.0",
    supportsFileImport: true,
    distribution: "SDK-Manager",
    distributionInstalled: false,
    release: "",
  };
  const GIB = 1024 ** 3;
  assert.match(memoryWarning({ ...base, memory: { total: 4 * GIB, free: 2 * GIB } }), /peu de mémoire \(4 Go\)/);
  assert.match(
    memoryWarning({ ...base, memory: { total: 16 * GIB, free: 1.5 * GIB } }),
    /peu de mémoire libre \(1\.5 Go\)/,
  );
  assert.equal(memoryWarning({ ...base, memory: { total: 16 * GIB, free: 8 * GIB } }), "");
  assert.equal(memoryWarning({ ...base, distributionInstalled: true, memory: { total: 4 * GIB, free: 1 } }), "");
  assert.equal(memoryWarning(base), "");
});
