const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

/**
 * Mise à jour de l'application en un clic, sans signature de code.
 *
 * `scripts/publish_gitlab_release.sh` dépose les installateurs d'une version dans le registre de
 * paquets génériques du projet GitLab, lisible sans identifiants, avec `update-manifest.json` qui
 * donne la taille et l'empreinte SHA-512 de chacun. Le fichier téléchargé est refusé s'il diffère.
 *
 * Le mécanisme d'Electron (Squirrel) refuse sur macOS toute mise à jour non signée : l'application
 * est donc remplacée par un petit script, une fois fermée. Sous Windows, l'installateur tourne en
 * silencieux ; sous Linux, l'AppImage est remplacée, et un paquet .deb est confié à l'installateur
 * du système.
 */

const PACKAGE_REGISTRY_URL =
  "https://gitlab.sudokeys.com/api/v4/projects/cdp%2Fsdk-local-manager/packages/generic/sdk-local-manager";
const MANIFEST_NAME = "update-manifest.json";
const BUNDLE_IDENTIFIER = "com.sudokeys.odoo-manager";
const RELEASE_TAG = /^app-v(\d+\.\d+\.\d+)(?:-build\d+)?$/;
const INSTALLER_NAME = /^SDK-Local-Manager-(\d+\.\d+\.\d+)-(mac|win|linux)-([A-Za-z0-9_]+)\.(dmg|exe|AppImage|deb)$/;
const SHA512_HEX = /^[0-9a-f]{128}$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 4 * 1024 ** 3;
const MANIFEST_TIMEOUT_MS = 30_000;
// Un téléchargement sans aucun octet reçu pendant ce délai est abandonné, quelle que soit sa taille.
const STALL_TIMEOUT_MS = 60_000;
const PROGRESS_INTERVAL_MS = 200;
// Marge laissée sur le disque en plus de l'installateur (et, sous macOS, de sa copie extraite).
const FREE_SPACE_MARGIN_BYTES = 256 * 1024 ** 2;
const SYSTEMS = { darwin: "mac", win32: "win", linux: "linux" };
const ARCHITECTURES = { x64: ["x64", "x86_64", "amd64"], arm64: ["arm64", "aarch64"] };
// Variables d'une AppImage en cours : la nouvelle les redéfinit, les anciennes pointeraient vers
// un montage qui disparaît avec l'application fermée.
const APPIMAGE_VARIABLES = ["APPIMAGE", "APPDIR", "ARGV0", "OWD"];

const UNAVAILABLE = "Cette version n'est pas encore disponible au téléchargement automatique.";
const UNREACHABLE = "Téléchargement impossible : vérifie la connexion à Internet, puis réessaie.";
const CORRUPTED = "Le fichier téléchargé est incomplet ou altéré. Réessaie plus tard.";

// Attend la fermeture de l'application, la remplace par la nouvelle version, puis la relance.
// En cas d'échec du remplacement, l'ancienne version est remise en place et relancée.
const MAC_SCRIPT = `pid=$1
app=$2
staged=$3
backup=$4
executable=$5
workdir=$6
n=0
while kill -0 "$pid" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -gt 1200 ]; then
    echo "L'application ne s'est pas fermée : mise à jour abandonnée."
    exit 1
  fi
  sleep 0.1
done
if mv "$app" "$backup"; then
  if mv "$staged" "$app"; then
    rm -rf "$backup"
    echo "Nouvelle version en place."
  else
    mv "$backup" "$app"
    echo "Remplacement impossible : version précédente remise en place."
  fi
else
  echo "Application installée impossible à déplacer : mise à jour abandonnée."
fi
rm -rf "$workdir"
rmdir "$(dirname "$workdir")" 2>/dev/null
if [ -x "$app/$executable" ]; then
  exec "$app/$executable" >/dev/null 2>&1
fi
exec /usr/bin/open "$app"
`;

// L'AppImage est déjà remplacée : il ne reste qu'à attendre la fermeture avant de la relancer,
// sinon la nouvelle instance céderait la place à l'ancienne (une seule instance à la fois).
const LINUX_SCRIPT = `pid=$1
target=$2
n=0
while kill -0 "$pid" 2>/dev/null; do
  n=$((n + 1))
  [ "$n" -gt 1200 ] && exit 1
  sleep 0.1
done
exec "$target" >/dev/null 2>&1
`;

// L'installateur ne démarre qu'une fois l'application fermée, backend arrêté : il ne trouve aucun
// fichier verrouillé. --updated et --force-run sont ceux d'electron-updater pour NSIS.
const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "Wait-Process -Id ([int]$env:SDK_UPDATE_PID) -Timeout 120",
  "Start-Process -FilePath $env:SDK_UPDATE_INSTALLER -ArgumentList '--updated','/S','--force-run'",
].join("\n");

class UpdateError extends Error {}

function versionKey(version) {
  return String(version)
    .split(/[-+]/)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isNewer(candidate, current) {
  const next = versionKey(candidate);
  const installed = versionKey(current);
  for (let index = 0; index < 3; index++) {
    if ((next[index] || 0) !== (installed[index] || 0)) return (next[index] || 0) > (installed[index] || 0);
  }
  return false;
}

/** Installateurs valides du manifeste d'une version ; une entrée douteuse est ignorée. */
function parseManifest(text, version) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new UpdateError("Le descriptif de la nouvelle version est illisible.");
  }
  if (!manifest || manifest.version !== version || !Array.isArray(manifest.files)) {
    throw new UpdateError("Le descriptif ne correspond pas à la version annoncée.");
  }
  const installers = [];
  for (const entry of manifest.files) {
    const match = typeof entry?.name === "string" ? INSTALLER_NAME.exec(entry.name) : null;
    if (!match || match[1] !== version) continue;
    if (typeof entry.sha512 !== "string" || !SHA512_HEX.test(entry.sha512)) continue;
    if (!Number.isInteger(entry.size) || entry.size <= 0 || entry.size > MAX_INSTALLER_BYTES) continue;
    installers.push({
      name: entry.name,
      sha512: entry.sha512,
      size: entry.size,
      system: match[2],
      arch: match[3],
      kind: match[4],
    });
  }
  return installers;
}

function installerKind(platform, env) {
  if (platform === "darwin") return "dmg";
  if (platform === "win32") return "exe";
  if (platform === "linux") return env.APPIMAGE ? "AppImage" : "deb";
  return "";
}

function selectInstaller(installers, { platform, arch, env }) {
  const system = SYSTEMS[platform];
  const kind = installerKind(platform, env);
  const names = ARCHITECTURES[arch] || [arch];
  return installers.find((item) => item.system === system && item.kind === kind && names.includes(item.arch)) || null;
}

/** Dossier `.app` de l'application en cours, ou "" hors d'un paquet macOS. */
function macBundle(execPath) {
  const marker = ".app/Contents/MacOS/";
  const index = execPath.lastIndexOf(marker);
  return index < 0 ? "" : execPath.slice(0, index + 4);
}

function writable(target) {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Octets libres sur le disque du dossier ; l'infini si le système ne sait pas le dire. */
function availableBytes(directory) {
  try {
    const stats = fs.statfsSync(directory);
    return stats.bavail * stats.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

/** Lance un processus qui survit à l'application ; résolu une fois le processus démarré. */
function spawnDetached(command, args, { env, logPath } = {}) {
  return new Promise((resolve, reject) => {
    let output = "ignore";
    try {
      if (logPath) output = fs.openSync(logPath, "a");
    } catch {
      output = "ignore";
    }
    const child = spawn(command, args, { detached: true, env, stdio: ["ignore", output, output], windowsHide: true });
    if (typeof output === "number") fs.closeSync(output);
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

class AppUpdater {
  constructor({
    currentVersion,
    workDir,
    fetch,
    openPath,
    packaged = true,
    platform = process.platform,
    arch = process.arch,
    execPath = process.execPath,
    env = process.env,
    pid = process.pid,
    baseUrl = PACKAGE_REGISTRY_URL,
    logPath = "",
    run = runCommand,
    launch = spawnDetached,
    freeSpace = availableBytes,
    onProgress = () => {},
    log = () => {},
  }) {
    this.currentVersion = currentVersion;
    this.workDir = workDir;
    this.fetch = fetch;
    this.openPath = openPath;
    this.packaged = packaged;
    this.platform = platform;
    this.arch = arch;
    this.execPath = execPath;
    this.env = env;
    this.pid = pid;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.logPath = logPath;
    this.run = run;
    this.launch = launch;
    this.freeSpace = freeSpace;
    this.onProgress = onProgress;
    this.log = log;
    this.bundle = platform === "darwin" ? macBundle(execPath) : "";
    this.pending = null;
    this.prepared = null;
    this.installing = false;
  }

  /**
   * Ce que l'application sait faire ici : se remplacer et redémarrer (`restart`), ouvrir
   * l'installateur pour que l'utilisateur termine (`installer`), ou rien (`none`).
   */
  support() {
    const none = { mode: "none", hint: "" };
    const restart = { mode: "restart", hint: "" };
    if (!this.packaged) return none;
    if (this.platform === "darwin") {
      if (!this.bundle) return none;
      // Application lancée depuis l'image disque ou isolée par macOS, ou dossier protégé :
      // l'utilisateur la glisse lui-même dans Applications.
      if (
        this.bundle.includes("/AppTranslocation/") ||
        !writable(path.dirname(this.bundle)) ||
        !writable(this.bundle)
      ) {
        return {
          mode: "installer",
          hint: "Glisse SDK Local Manager dans le dossier Applications, puis rouvre l'application.",
        };
      }
      return restart;
    }
    if (this.platform === "win32") return restart;
    if (this.platform === "linux") {
      const appImage = this.env.APPIMAGE;
      if (appImage) return writable(path.dirname(appImage)) && writable(appImage) ? restart : none;
      return {
        mode: "installer",
        hint: "Termine l'installation dans la fenêtre qui s'ouvre, puis rouvre l'application.",
      };
    }
    return none;
  }

  /** Supprime les téléchargements d'une mise à jour précédente, terminée ou abandonnée. */
  cleanup() {
    try {
      fs.rmSync(this.workDir, { recursive: true, force: true });
    } catch {
      /* Installateur encore ouvert (Windows) : il sera supprimé au prochain lancement. */
    }
  }

  /** Télécharge et vérifie la version `tag` ; une seule à la fois. */
  async download(tag) {
    const support = this.support();
    if (support.mode === "none")
      throw new UpdateError("La mise à jour automatique n'est pas possible pour cette installation.");
    const match = typeof tag === "string" ? RELEASE_TAG.exec(tag) : null;
    if (!match) throw new UpdateError("Version demandée invalide.");
    const version = match[1];
    // L'interface ne choisit que le tag : une version plus ancienne n'est jamais installée.
    if (!isNewer(version, this.currentVersion)) {
      throw new UpdateError("Cette version n'est pas plus récente que celle installée.");
    }
    if (this.prepared?.tag === tag) return this.result(this.prepared);
    if (this.pending?.tag === tag) return this.pending.promise;
    if (this.pending || this.installing) throw new UpdateError("Une mise à jour est déjà en cours.");
    const promise = this.prepare(tag, version, support).finally(() => {
      this.pending = null;
    });
    this.pending = { tag, promise };
    return promise;
  }

  result(prepared) {
    return { version: prepared.version, mode: prepared.mode, hint: prepared.hint };
  }

  async prepare(tag, version, support) {
    this.prepared = null;
    const directory = path.join(this.workDir, tag);
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      const installers = parseManifest(await this.fetchText(`${this.baseUrl}/${tag}/${MANIFEST_NAME}`), version);
      const installer = selectInstaller(installers, this);
      if (!installer) throw new UpdateError("Cette version ne propose pas d'installateur pour cet ordinateur.");
      // L'image disque macOS est en plus extraite : de quoi tenir les deux.
      const needed = installer.size * (installer.kind === "dmg" ? 2 : 1) + FREE_SPACE_MARGIN_BYTES;
      if (this.freeSpace(directory) < needed) {
        throw new UpdateError("Espace disque insuffisant pour télécharger la mise à jour.");
      }
      const file = path.join(directory, installer.name);
      await this.fetchFile(`${this.baseUrl}/${tag}/${encodeURIComponent(installer.name)}`, file, installer);
      let staged = "";
      if (installer.kind === "dmg" && support.mode === "restart")
        staged = await this.stageMacApp(file, version, directory);
      if (installer.kind === "AppImage") fs.chmodSync(file, 0o755);
      this.prepared = { tag, version, mode: support.mode, hint: support.hint, file, staged, directory };
      this.log(`Mise à jour ${version} téléchargée et vérifiée : ${installer.name}.`);
      return this.result(this.prepared);
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      this.log(`Mise à jour ${version} impossible : ${error.message}`);
      throw error instanceof UpdateError ? error : new UpdateError(UNREACHABLE);
    }
  }

  async request(url, signal) {
    let response;
    try {
      response = await this.fetch(url, { redirect: "follow", signal, headers: { Accept: "*/*" } });
    } catch {
      throw new UpdateError(UNREACHABLE);
    }
    // GitLab peut rediriger vers son stockage : jamais vers une adresse moins sûre que la sienne.
    if (response.url && new URL(response.url).protocol !== new URL(this.baseUrl).protocol) {
      throw new UpdateError("Le téléchargement a été redirigé vers une adresse non sécurisée.");
    }
    // Registre encore privé (401, 403) ou version publiée avant la mise à jour automatique (404).
    if ([401, 403, 404].includes(response.status)) throw new UpdateError(UNAVAILABLE);
    if (!response.ok) throw new UpdateError(`GitLab a refusé le téléchargement (code ${response.status}).`);
    return response;
  }

  async fetchText(url) {
    const response = await this.request(url, AbortSignal.timeout(MANIFEST_TIMEOUT_MS));
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_MANIFEST_BYTES) throw new UpdateError("Le descriptif de la nouvelle version est illisible.");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_MANIFEST_BYTES) throw new UpdateError("Le descriptif de la nouvelle version est illisible.");
    return body.toString("utf8");
  }

  async fetchFile(url, destination, expected) {
    const controller = new AbortController();
    let timer;
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };
    watch();
    const hash = crypto.createHash("sha512");
    let received = 0;
    let reportedAt = 0;
    const onProgress = this.onProgress;
    try {
      const response = await this.request(url, controller.signal);
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared && declared !== expected.size) throw new UpdateError(CORRUPTED);
      const verify = new Transform({
        transform(chunk, _encoding, callback) {
          watch();
          received += chunk.length;
          if (received > expected.size) {
            callback(new UpdateError(CORRUPTED));
            return;
          }
          hash.update(chunk);
          const now = Date.now();
          if (now - reportedAt >= PROGRESS_INTERVAL_MS) {
            reportedAt = now;
            onProgress({ received, total: expected.size });
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), verify, fs.createWriteStream(destination, { mode: 0o600 }));
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      if (controller.signal.aborted) {
        throw new UpdateError("Le téléchargement s'est interrompu. Vérifie la connexion, puis réessaie.");
      }
      throw new UpdateError(UNREACHABLE);
    } finally {
      clearTimeout(timer);
    }
    onProgress({ received, total: expected.size });
    if (received !== expected.size || hash.digest("hex") !== expected.sha512) throw new UpdateError(CORRUPTED);
  }

  /**
   * Monte l'image disque en lecture seule, sans fenêtre ni icône dans le Finder.
   *
   * `hdiutil` est déclaré obsolète par macOS au profit de `diskutil image`, absent des versions
   * plus anciennes : `diskutil` d'abord, `hdiutil` en repli.
   */
  async attachImage(image, volume) {
    try {
      await this.run("/usr/sbin/diskutil", [
        "image",
        "attach",
        "--readOnly",
        "--nobrowse",
        "--mountPoint",
        volume,
        image,
      ]);
      return;
    } catch (error) {
      this.log(`diskutil image indisponible (${error.message}) : hdiutil prend le relais.`);
    }
    await this.run("/usr/bin/hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-noautoopen",
      "-mountpoint",
      volume,
      image,
    ]);
  }

  /** Démonte l'image, quel que soit l'outil qui l'a montée ; de force seulement en dernier recours. */
  async detachImage(volume) {
    const attempts = [
      ["/usr/sbin/diskutil", ["eject", volume]],
      ["/usr/bin/hdiutil", ["detach", volume]],
      ["/usr/sbin/diskutil", ["eject", "force", volume]],
      ["/usr/bin/hdiutil", ["detach", "-force", volume]],
    ];
    for (const [command, args] of attempts) {
      try {
        await this.run(command, args);
        return;
      } catch {
        /* Outil absent ou volume occupé : essai suivant. */
      }
    }
  }

  /** Copie l'application de l'image disque vérifiée, puis contrôle son identité et son intégrité. */
  async stageMacApp(image, version, directory) {
    const volume = path.join(directory, "volume");
    const staged = path.join(directory, "staged", path.basename(this.bundle));
    fs.mkdirSync(volume, { recursive: true });
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    try {
      await this.attachImage(image, volume);
    } catch {
      throw new UpdateError("L'image de la nouvelle version n'a pas pu être ouverte.");
    }
    try {
      const bundles = fs.readdirSync(volume).filter((name) => name.endsWith(".app"));
      if (bundles.length !== 1) throw new UpdateError("L'image téléchargée ne contient pas l'application attendue.");
      await this.run("/usr/bin/ditto", [path.join(volume, bundles[0]), staged]);
    } finally {
      await this.detachImage(volume);
    }
    const plist = path.join(staged, "Contents", "Info.plist");
    const read = (key) => this.run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]).catch(() => "");
    if (
      (await read("CFBundleIdentifier")) !== BUNDLE_IDENTIFIER ||
      (await read("CFBundleShortVersionString")) !== version
    ) {
      throw new UpdateError("L'application téléchargée ne correspond pas à la version annoncée.");
    }
    try {
      await this.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged]);
    } catch {
      throw new UpdateError("L'application téléchargée est endommagée. Réessaie plus tard.");
    }
    return staged;
  }

  /**
   * Installe la version prête. En mode `restart`, lance le remplaçant, appelle `beforeExit`
   * (arrêt du backend) puis `exit` ; en mode `installer`, ouvre seulement l'installateur.
   */
  async install({ beforeExit, exit }) {
    const prepared = this.prepared;
    if (!prepared) throw new UpdateError("Aucune mise à jour n'est prête à installer.");
    if (prepared.mode === "installer") {
      const failure = await this.openPath(prepared.file);
      if (failure) throw new UpdateError("L'installateur n'a pas pu s'ouvrir. Télécharge la version depuis GitLab.");
      return { mode: "installer" };
    }
    if (this.installing) return { mode: "restart" };
    this.installing = true;
    try {
      // Le remplaçant démarre avant l'arrêt du backend : s'il ne démarre pas, rien n'est arrêté.
      await this.launchReplacement(prepared);
    } catch (error) {
      this.installing = false;
      this.log(`Remplaçant non lancé : ${error.message}`);
      throw new UpdateError("La mise à jour n'a pas pu démarrer. Télécharge la version depuis GitLab.");
    }
    this.log(`Installation de la version ${prepared.version} : fermeture de l'application.`);
    await beforeExit();
    exit();
    return { mode: "restart" };
  }

  async launchReplacement(prepared) {
    const options = { env: this.env, logPath: this.logPath };
    if (this.platform === "darwin") {
      const backup = path.join(path.dirname(this.bundle), `.${path.basename(this.bundle)}.previous-${Date.now()}`);
      const executable = path.relative(this.bundle, this.execPath);
      await this.launch(
        "/bin/sh",
        [
          "-c",
          MAC_SCRIPT,
          "sdk-update",
          String(this.pid),
          this.bundle,
          prepared.staged,
          backup,
          executable,
          prepared.directory,
        ],
        options,
      );
      return;
    }
    if (this.platform === "win32") {
      const powershell = path.join(
        this.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      await this.launch(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-Command",
          WINDOWS_SCRIPT,
        ],
        { ...options, env: { ...this.env, SDK_UPDATE_PID: String(this.pid), SDK_UPDATE_INSTALLER: prepared.file } },
      );
      return;
    }
    // AppImage : remplacée tout de suite, par renommage dans son propre dossier.
    const target = this.env.APPIMAGE;
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.update`);
    fs.copyFileSync(prepared.file, temporary);
    fs.chmodSync(temporary, 0o755);
    fs.renameSync(temporary, target);
    const env = { ...this.env };
    for (const name of APPIMAGE_VARIABLES) delete env[name];
    await this.launch("/bin/sh", ["-c", LINUX_SCRIPT, "sdk-update", String(this.pid), target], { ...options, env });
  }
}

module.exports = {
  AppUpdater,
  LINUX_SCRIPT,
  MAC_SCRIPT,
  MANIFEST_NAME,
  PACKAGE_REGISTRY_URL,
  UpdateError,
  isNewer,
  macBundle,
  parseManifest,
  selectInstaller,
};
