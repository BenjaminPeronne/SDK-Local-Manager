const { contextBridge, ipcRenderer } = require("electron");

// L'environnement Linux n'existe que sous Windows : ailleurs, l'interface ne doit même pas
// voir ces capacités, sinon elle propose de préparer un poste qui n'a pas de WSL.
const wslCapabilities =
  process.platform !== "win32"
    ? {}
    : {
        wslStatus: () => ipcRenderer.invoke("sdk:wsl-status"),
        wslInstallWsl: () => ipcRenderer.invoke("sdk:wsl-install-wsl"),
        wslPrepare: () => ipcRenderer.invoke("sdk:wsl-prepare"),
        wslLegacyWorkspace: () => ipcRenderer.invoke("sdk:wsl-legacy-workspace"),
        wslImportSshKey: () => ipcRenderer.invoke("sdk:wsl-import-ssh-key"),
        wslOpenEditor: (project) => ipcRenderer.invoke("sdk:wsl-open-editor", project),
        wslOpenExplorer: (project) => ipcRenderer.invoke("sdk:wsl-open-explorer", project),
        // Avancement de la préparation. Seule la charge utile passe au rendu, jamais l'événement IPC.
        onWslProgress: (callback) => {
          const listener = (_event, step) => callback(step);
          ipcRenderer.on("sdk:wsl-progress", listener);
          return () => ipcRenderer.removeListener("sdk:wsl-progress", listener);
        },
      };

// Expose capabilities individually; the renderer never receives raw IPC or Node access.
contextBridge.exposeInMainWorld(
  "sdkDesktop",
  Object.freeze({
    getVersion: () => ipcRenderer.invoke("sdk:version"),
    backendEndpoint: () => ipcRenderer.invoke("sdk:backend-endpoint"),
    backendDiagnostics: () => ipcRenderer.invoke("sdk:backend-diagnostics"),
    openExternalUrl: (url) => ipcRenderer.invoke("sdk:open-external", url),
    openDockerDesktop: () => ipcRenderer.invoke("sdk:open-docker"),
    backendMode: () => ipcRenderer.invoke("sdk:backend-mode"),
    ...wslCapabilities,
    relaunch: () => ipcRenderer.invoke("sdk:relaunch"),
    stopLegacyTraefik: () => ipcRenderer.invoke("sdk:stop-legacy-traefik"),
    pickDirectory: (defaultPath) => ipcRenderer.invoke("sdk:pick-directory", defaultPath),
    notificationsSupported: () => ipcRenderer.invoke("sdk:notifications-supported"),
    notify: (title, body) => ipcRenderer.invoke("sdk:notify", { title, body }),
    rikaCredentials: () => ipcRenderer.invoke("sdk:rika-credentials"),
    saveRikaCredentials: (login, password) => ipcRenderer.invoke("sdk:save-rika-credentials", { login, password }),
    clearRikaCredentials: () => ipcRenderer.invoke("sdk:clear-rika-credentials"),
    gitlabStatus: () => ipcRenderer.invoke("sdk:gitlab-status"),
    gitlabConnect: (token) => ipcRenderer.invoke("sdk:gitlab-connect", token),
    gitlabDisconnect: () => ipcRenderer.invoke("sdk:gitlab-disconnect"),
    gitlabProjects: (search) => ipcRenderer.invoke("sdk:gitlab-projects", search),
    gitlabRefs: (projectId, search) => ipcRenderer.invoke("sdk:gitlab-refs", projectId, search),
  }),
);
