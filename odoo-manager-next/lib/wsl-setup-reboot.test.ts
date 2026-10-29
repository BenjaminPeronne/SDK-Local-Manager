import { test } from "node:test";
import assert from "node:assert/strict";
import { isWslSetupPending, wslSetupError, wslSetupState, type WslStatus } from "./wsl-setup.ts";

// Paquet WSL présent, composant Windows inactif : `wsl --version` répond, rien d'autre ne démarre.
const componentMissing: WslStatus = {
  wslInstalled: false,
  wslVersion: "2.6.1.0",
  supportsFileImport: true,
  distribution: "SDK-Manager",
  distributionInstalled: false,
  release: "",
  wslComponentMissing: true,
};

test("a WSL waiting for the restart asks for the restart, not for a new activation", () => {
  const state = wslSetupState({ ...componentMissing, rebootPending: true }, "0.6.0");
  assert.equal(state.step, "reboot-required");
  assert.match(state.detail, /Redémarre/);
  assert.equal(state.needsElevation, false);
  assert.equal(isWslSetupPending({ ...componentMissing, rebootPending: true }, "0.6.0"), true);
});

test("a component never activated is offered the activation", () => {
  const state = wslSetupState({ ...componentMissing, rebootPending: false }, "0.6.0");
  assert.equal(state.step, "install-wsl");
  assert.equal(state.needsElevation, true);
});

test("disabled virtualization is still announced first", () => {
  assert.equal(
    wslSetupState({ ...componentMissing, rebootPending: true, virtualization: "disabled" }, "0.6.0").step,
    "virtualization-disabled",
  );
});

test("the Windows component error asks for the restart instead of more attempts", () => {
  const raw = wslSetupError(
    new Error(
      "Cette application nécessite le composant facultatif Sous-système Windows pour Linux.\n" +
        "Code d’erreur : Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED",
    ),
  );
  assert.match(raw, /Redémarre l'ordinateur/);
  assert.doesNotMatch(raw, /Préparer mon poste/);
  const fromPreparation = wslSetupError(
    new Error(
      "Error invoking remote method 'sdk:wsl-prepare': Error: Le composant Windows « Sous-système Windows pour Linux » " +
        "n'est pas encore actif : redémarre l'ordinateur, puis rouvre l'application.",
    ),
  );
  assert.match(fromPreparation, /Redémarre l'ordinateur/);
});
