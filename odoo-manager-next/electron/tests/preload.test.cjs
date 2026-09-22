const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const PRELOAD = require.resolve("../preload.cjs");
const WSL_CAPABILITIES = [
  "wslStatus",
  "wslInstallWsl",
  "wslPrepare",
  "wslLegacyWorkspace",
  "wslImportSshKey",
  "wslOpenEditor",
  "wslOpenExplorer",
  "onWslProgress",
];

/** Charge le préchargement comme Electron le ferait, sur le système demandé. */
function exposedApi(platform) {
  const exposed = {};
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        exposed[name] = api;
      },
    },
    ipcRenderer: { invoke: (channel) => Promise.resolve(channel) },
  };
  const load = Module._load;
  const currentPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Module._load = (request, ...rest) => (request === "electron" ? electron : load(request, ...rest));
  try {
    delete require.cache[PRELOAD];
    require(PRELOAD);
  } finally {
    Module._load = load;
    Object.defineProperty(process, "platform", { value: currentPlatform, configurable: true });
    delete require.cache[PRELOAD];
  }
  return exposed.sdkDesktop;
}

test("the Linux environment is offered on Windows only", () => {
  const windows = exposedApi("win32");
  for (const capability of WSL_CAPABILITIES) assert.equal(typeof windows[capability], "function", capability);

  for (const platform of ["darwin", "linux"]) {
    const api = exposedApi(platform);
    for (const capability of WSL_CAPABILITIES)
      assert.equal(api[capability], undefined, `${capability} sur ${platform}`);
  }
});

test("the rest of the bridge is identical on every system", () => {
  const windows = Object.keys(exposedApi("win32")).filter((name) => !WSL_CAPABILITIES.includes(name));
  assert.deepEqual(Object.keys(exposedApi("darwin")), windows);
  assert.ok(windows.includes("backendEndpoint") && windows.includes("stopLegacyTraefik"));
});
