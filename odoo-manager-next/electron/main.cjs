const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Notification,
  protocol,
  net,
  session,
  Menu,
  safeStorage,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFile, spawn } = require("node:child_process");
const {
  APP_ORIGIN,
  API_TOKEN_HEADER,
  Backend,
  configPath,
  externalUrl,
  staticPath,
  contentPolicy,
} = require("./runtime.cjs");
const { CredentialStore } = require("./credentials.cjs");
const { diskEncryptionStatus } = require("./disk-encryption.cjs");
const { GitLabClient } = require("./gitlab.cjs");
const { AppUpdater } = require("./updater.cjs");
const {
  LINUX_WORKSPACE,
  WslEnvironment,
  imageFiles,
  legacyWindowsWorkspace,
  wslStartFailureReason,
} = require("./wsl.cjs");

app.setName("SDK Local Manager");
app.setAppUserModelId("com.sudokeys.odoo-manager");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
const smokePath = process.env.ODOO_MANAGER_SMOKE_REPORT;
// Isolated smoke runs must never attach to or close the user's existing application.
if (smokePath && !process.env.ODOO_MANAGER_CONFIG_DIR) throw new Error("Le smoke test exige une configuration isolée.");
if (smokePath) app.setPath("userData", path.join(process.env.ODOO_MANAGER_CONFIG_DIR, "electron"));
let window;
let backend;
let wsl;
let updater;
// Motif lisible quand l'environnement Linux a échoué et que le backend Windows a pris le relais.
let degradedBackend = "";
let quitting = false;
const notifications = new Set();

function wslResources() {
  const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "electron/binaries");
  return {
    ...imageFiles(root, app.getVersion()),
    backendSource: path.join(root, "backend-linux"),
  };
}

/**
 * Prépare l'environnement Linux pour la version courante, puis dit si le backend peut y tourner.
 *
 * Redémarrer la distribution pour reprendre une étape bloquée couperait un backend qui y tourne
 * déjà : ce n'est permis que tant que le backend en service est celui de Windows.
 */
async function prepareWslEnvironment({ restartAllowed = !backend?.command } = {}) {
  const resources = wslResources();
  return wsl.prepare({ version: app.getVersion(), ...resources, restartAllowed });
}

/** Dossier de projets de l'ancien backend Windows : chemin Windows et vue depuis la distribution. */
function legacyWorkspace() {
  let configText = "";
  try {
    configText = fs.readFileSync(configPath(), "utf8");
  } catch {
    /* Réglages jamais enregistrés : le dossier par défaut s'applique. */
  }
  const windows = legacyWindowsWorkspace({ configText, home: app.getPath("home") });
  return { windows, mounted: WslEnvironment.mountedWindowsPath(windows) };
}

/** Dossier de projets du backend Windows, vu depuis la distribution : source de la migration. */
function windowsWorkspaceSeenFromWsl() {
  return legacyWorkspace().mounted;
}

/** Une migration absente ne doit plus être silencieuse : le journal dit ce qui a été trouvé. */
function describeLegacyWorkspace({ windows, mounted }) {
  if (!windows) return "Migration : aucun ancien dossier de projets Windows trouvé.";
  if (!mounted)
    return `Migration : ancien dossier ${windows} hors d'un disque Windows (C:, D:…), migration impossible.`;
  return `Migration : anciens projets recherchés dans ${windows} (${mounted}).`;
}

/**
 * Arrête le Traefik de Docker Desktop, qui tient le port 80 dans le réseau partagé de WSL.
 *
 * Seul un conteneur `traefik` dont l'image est Traefik est arrêté, jamais supprimé : sa
 * politique `unless-stopped` le laisse arrêté, et `docker start traefik` le relance.
 */
function stopLegacyTraefik() {
  const docker = (args, timeout = 30000) =>
    new Promise((resolve, reject) => {
      execFile("docker", args, { windowsHide: true, timeout }, (error, stdout, stderr) =>
        error ? reject(new Error((stderr || error.message).trim())) : resolve(stdout.trim()),
      );
    });
  return docker(["inspect", "-f", "{{.Config.Image}}", "traefik"], 10000)
    .catch(() => {
      throw new Error("Aucun conteneur Traefik de Docker Desktop à arrêter.");
    })
    .then((image) => {
      if (!/(^|\/)traefik(:|@|$)/i.test(image))
        throw new Error(`Le conteneur « traefik » n'est pas une image Traefik (${image}) : il n'est pas arrêté.`);
      return docker(["stop", "traefik"]);
    })
    .then(() => ({ ok: true, message: "Ancien Traefik de Docker Desktop arrêté." }));
}

// Même règle que PROJECT_NAME_RE côté backend : l'interface ne peut pas fabriquer un chemin.
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

function projectName(value) {
  if (typeof value !== "string" || !PROJECT_NAME.test(value)) throw new Error("Nom de projet invalide.");
  return value;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openDocker() {
  if (process.platform === "darwin") return run("open", ["-a", "Docker"]);
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Docker/Docker/Docker Desktop.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs/Docker/Docker/Docker Desktop.exe"),
    ];
    const executable = candidates.find((candidate) => fs.existsSync(candidate));
    if (executable) return run(executable, []);
    throw new Error("Docker Desktop est introuvable.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn("systemctl", ["--user", "start", "docker-desktop"], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Démarrez Docker depuis le système."))));
  });
}

function installHandlers() {
  const handle = (name, callback) =>
    ipcMain.handle("sdk:" + name, (event, ...args) => {
      const frame = event.senderFrame;
      if (
        !window ||
        event.sender !== window.webContents ||
        frame !== window.webContents.mainFrame ||
        !frame.url.startsWith(APP_ORIGIN + "/")
      )
        throw new Error("Appel natif non autorisé.");
      return callback(...args);
    });
  handle("version", () => app.getVersion());
  handle("backend-endpoint", () => backend.endpoint);
  handle("backend-diagnostics", () => backend.diagnostics());
  handle("open-external", (url) => shell.openExternal(externalUrl(url)));
  handle("open-docker", openDocker);
  // Le journal est demandé quand une préparation échoue : l'utilisateur le trouve en un clic.
  handle("open-log-folder", () => shell.showItemInFolder(backend.logPath));
  // Seul le dossier des projets vient de l'interface : il désigne le disque à contrôler. Le
  // système est celui de l'ordinateur, pas celui du backend (Linux sous Windows).
  handle("disk-encryption", async (workspace) => ({
    state: await diskEncryptionStatus({
      workspace: typeof workspace === "string" && workspace.length <= 32768 ? workspace : "",
      fallbackPath: wsl?.installRoot || "",
    }),
    platform: process.platform,
  }));
  // L'environnement Linux n'existe que sous Windows. Le préchargement ne propose même pas ces
  // commandes ailleurs ; un appel malgré tout est refusé, jamais traité comme un WSL manquant.
  const onWindows =
    (callback) =>
    (...args) => {
      if (!wsl) throw new Error("L'environnement Linux n'existe que sous Windows.");
      return callback(...args);
    };
  // L'interface prévient l'utilisateur que le poste tourne en mode lent, et pourquoi.
  handle("backend-mode", () => ({ wsl: Boolean(backend.command), degradedReason: degradedBackend }));
  handle(
    "wsl-status",
    onWindows(() => wsl.status()),
  );
  handle(
    "wsl-install-wsl",
    onWindows(() => wsl.installWsl()),
  );
  handle(
    "wsl-prepare",
    onWindows(() => prepareWslEnvironment()),
  );
  // Interrogé souvent par l'écran de chargement : aucune commande WSL n'est lancée.
  handle(
    "wsl-preparation",
    onWindows(() => wsl.preparation()),
  );
  handle(
    "wsl-legacy-workspace",
    onWindows(() => windowsWorkspaceSeenFromWsl()),
  );
  handle("relaunch", () => {
    app.relaunch();
    app.quit();
  });
  handle("stop-legacy-traefik", stopLegacyTraefik);
  handle(
    "wsl-import-ssh-key",
    onWindows(() => wsl.importSshKey(path.join(app.getPath("home"), ".ssh"))),
  );
  handle(
    "wsl-open-editor",
    onWindows((project) => wsl.openEditor(`${LINUX_WORKSPACE}/${projectName(project)}`)),
  );
  handle(
    "wsl-open-explorer",
    onWindows((project) => shell.openPath(wsl.explorerPath(`${LINUX_WORKSPACE}/${projectName(project)}`))),
  );
  handle("pick-directory", async (defaultPath) => {
    if (defaultPath !== undefined && (typeof defaultPath !== "string" || defaultPath.length > 32768))
      throw new Error("Chemin invalide.");
    const result = await dialog.showOpenDialog(window, {
      title: "Choisir le dossier des projets Odoo",
      defaultPath: defaultPath || undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  const credentials = new CredentialStore({ directory: app.getPath("userData"), safeStorage });
  handle("rika-credentials", () => credentials.read());
  handle("save-rika-credentials", (payload) => credentials.save(payload));
  handle("clear-rika-credentials", () => credentials.clear());
  // Le jeton GitLab reste dans ce processus : l'interface ne reçoit que des résultats.
  const gitlab = new GitLabClient({
    directory: app.getPath("userData"),
    safeStorage,
    fetch: (url, init) => net.fetch(url, init),
  });
  handle("gitlab-status", () => gitlab.status());
  handle("gitlab-connect", (token) => gitlab.connect(token));
  handle("gitlab-disconnect", () => gitlab.disconnect());
  handle("gitlab-projects", (search) => gitlab.searchProjects(search));
  handle("gitlab-refs", (id, search) => gitlab.listRefs(id, search));
  // Mise à jour en un clic : l'interface ne fournit que le tag annoncé, tout le reste se décide ici.
  handle("update-support", () => updater.support());
  handle("update-download", (tag) => updater.download(tag));
  handle("update-install", () =>
    updater.install({
      beforeExit: () => backend.stop(),
      exit: () => {
        quitting = true;
        app.exit(0);
      },
    }),
  );
  handle("notifications-supported", () => Notification.isSupported());
  handle("notify", (payload) => {
    if (
      !payload ||
      typeof payload.title !== "string" ||
      typeof payload.body !== "string" ||
      payload.title.length > 256 ||
      payload.body.length > 8192
    )
      throw new Error("Notification invalide.");
    if (!Notification.isSupported()) return;
    const notification = new Notification(payload);
    notifications.add(notification);
    notification.once("close", () => notifications.delete(notification));
    notification.once("click", () => {
      window?.show();
      window?.focus();
    });
    notification.show();
  });
}

async function start() {
  const root = app.getAppPath();
  const out = path.join(root, "out");
  const binaryRoot = app.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.join(root, "electron/binaries");
  const logDir = process.env.ODOO_MANAGER_LOG_DIR || app.getPath("logs");
  const options = {
    executable: path.join(binaryRoot, "odoo-manager-backend" + (process.platform === "win32" ? ".exe" : "")),
    logDir,
  };
  if (process.platform === "win32") {
    wsl = new WslEnvironment({
      installRoot: path.join(app.getPath("userData"), "wsl"),
      log: (message) => fs.appendFileSync(path.join(logDir, "backend.log"), message + "\n"),
      // L'écran de préparation attend plusieurs minutes : il doit dire où en est l'installation.
      onProgress: (step) => window?.webContents.send("sdk:wsl-progress", step),
    });
    // `wsl --list` suffit pour choisir le backend et ne démarre pas la distribution : lire sa
    // version l'aurait démarrée avant même l'affichage de la fenêtre.
    const distributions = await wsl.distributions().catch(() => []);
    if (distributions.some((name) => name.toLowerCase() === wsl.distribution.toLowerCase())) {
      const legacy = legacyWorkspace();
      fs.appendFileSync(path.join(logDir, "backend.log"), describeLegacyWorkspace(legacy) + "\n");
      options.command = (port, instance) => wsl.backendCommand(port, instance, legacy.mounted);
      options.preferredPort = 18765;
      // Le backend de ce build doit être en place avant de démarrer : une mise à jour de
      // l'application change le backend sans forcément changer le numéro de version.
      options.beforeStart = () =>
        // Le backend n'est pas encore lancé : la distribution peut être redémarrée.
        prepareWslEnvironment({ restartAllowed: true }).catch((error) => {
          fs.appendFileSync(path.join(logDir, "backend.log"), `Préparation de l'environnement : ${error.message}\n`);
        });
      // Virtualisation désactivée, « Plateforme d'ordinateur virtuel » retirée : le backend
      // Windows reprend la main, et l'interface explique pourquoi le poste est redevenu lent.
      options.onFallback = (error) => {
        degradedBackend = wslStartFailureReason(error) || "L'environnement Linux n'a pas démarré sur ce poste.";
        fs.appendFileSync(path.join(logDir, "backend.log"), `Bascule sur le backend Windows. ${degradedBackend}\n`);
      };
    }
    // Sinon le backend Windows prend le relais, et l'interface propose de préparer le poste.
  }
  backend = new Backend(options);
  // L'adresse suffit pour bâtir la fenêtre ; le backend démarre en parallèle. L'interface a son
  // écran de chargement et réessaie seule, donc rien n'attend ici la disponibilité du backend.
  await backend.reserve();
  updater = new AppUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    // Dossier propre à l'utilisateur : /tmp, partagé sous Linux, laisserait un autre compte du
    // poste remplacer l'installateur entre sa vérification et son installation.
    workDir: path.join(app.getPath("userData"), "updates"),
    logPath: path.join(logDir, "update.log"),
    markerPath: path.join(app.getPath("userData"), "update-pending.json"),
    fetch: (url, init) => net.fetch(url, init),
    openPath: (file) => shell.openPath(file),
    onProgress: (progress) => window?.webContents.send("sdk:update-progress", progress),
    log: (message) => backend.log(message),
  });
  // Une mise à jour lancée avant ce démarrage a-t-elle pris ? Sinon, l'interface le dira.
  updater.checkPreviousAttempt();
  // Téléchargements d'une mise à jour précédente, installée ou abandonnée.
  updater.cleanup();
  const ready = backend.start().catch((error) => {
    backend.log(error.stack || error.message);
    // Keep the existing frontend's diagnostics and recovery screen available.
  });
  const csp = contentPolicy(fs.readFileSync(path.join(out, "index.html"), "utf8"), backend.endpoint);
  protocol.handle("app", async (request) => {
    try {
      const target = staticPath(request.url, out);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return new Response("Not found", { status: 404 });
      const response = await net.fetch(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", csp);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  });
  const mayWriteClipboard = (contents, permission) =>
    contents === window?.webContents &&
    contents.getURL().startsWith(APP_ORIGIN + "/") &&
    permission === "clipboard-sanitized-write";
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(mayWriteClipboard(contents, permission)),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission) => mayWriteClipboard(contents, permission));
  // Le jeton de l'API reste dans ce processus : il est ajouté ici à chaque requête vers le
  // backend (fetch, téléversements, flux SSE) et n'est jamais exposé au JavaScript de l'interface.
  // Ajouté après la décision CORS, il ne provoque pas de requête préalable supplémentaire.
  const backendPrefix = backend.endpoint + "/";
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!details.url.startsWith(backendPrefix)) return callback({ requestHeaders: details.requestHeaders });
    callback({ requestHeaders: { ...details.requestHeaders, [API_TOKEN_HEADER]: backend.apiToken } });
  });
  installHandlers();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  window = new BrowserWindow({
    title: "SDK Local Manager",
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    show: false,
    icon: path.join(root, "electron/icons/128x128@2x.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(externalUrl(url)).catch((error) => backend.log(error.message));
    } catch {
      /* forbidden scheme */
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN + "/")) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_event, details) => backend.log(JSON.stringify(details)));
  window.once("ready-to-show", () => {
    if (!smokePath) window.show();
  });
  await window.loadURL(APP_ORIGIN + "/");
  await ready;
  if (smokePath) await smokeCheck();
}

async function smokeCheck() {
  const report = { electron: process.versions.electron, backendReady: backend.ready };
  try {
    report.renderer = await window.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 120 && !document.querySelector('button'); i++) await new Promise(r => setTimeout(r, 250));
      return ({
      bridge: typeof window.sdkDesktop?.backendEndpoint === 'function',
      nodeExposed: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
      version: await window.sdkDesktop.getVersion(),
      health: await (await fetch((await window.sdkDesktop.backendEndpoint()) + '/api/health')).json(),
      title: document.title,
      rendered: !!document.querySelector('button'),
      bootstrap: Object.keys(await (await fetch((await window.sdkDesktop.backendEndpoint()) + '/api/bootstrap')).json())
    }); })()`);
    // Hors de la fenêtre, sans le jeton ajouté par la session : le backend doit refuser.
    report.unauthenticatedStatus = (await fetch(backend.endpoint + "/api/health")).status;
    report.ok =
      report.backendReady &&
      report.unauthenticatedStatus === 401 &&
      report.renderer.bridge &&
      !report.renderer.nodeExposed &&
      report.renderer.health.ok &&
      report.renderer.rendered &&
      ["overview", "settings", "jobs", "system_status"].every((key) => report.renderer.bootstrap.includes(key));
  } catch (error) {
    report.ok = false;
    report.error = String(error);
  }
  fs.writeFileSync(smokePath, JSON.stringify(report, null, 2));
  app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void (backend?.stop() || Promise.resolve()).finally(() => app.quit());
  });
  app
    .whenReady()
    .then(start)
    .catch(async (error) => {
      if (smokePath) fs.writeFileSync(smokePath, JSON.stringify({ ok: false, error: String(error) }));
      else dialog.showErrorBox("Démarrage impossible", String(error));
      await backend?.stop();
      app.quit();
    });
}
