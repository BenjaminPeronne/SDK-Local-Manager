"use strict";
// Environnement Linux du gestionnaire sous Windows.
//
// Les projets servis depuis C:\ traversent le pont 9P de Docker Desktop : Odoo met
// 48 à 95 s à démarrer, contre 4 à 6 s sur un système de fichiers Linux. Le
// gestionnaire installe donc sa propre distribution WSL, y lance le backend, et
// l'utilisateur n'ouvre jamais de terminal.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");

const DISTRIBUTION = "SDK-Manager";
const SDK_DIRECTORY = "/opt/sdk-manager";
// Le backend est un exécutable accompagné de son dossier de runtime (PyInstaller onedir) :
// il vit dans son propre dossier, remplacé d'un bloc à chaque mise à jour.
const BACKEND_DIRECTORY = SDK_DIRECTORY + "/backend";
const BACKEND_EXECUTABLE = "odoo-manager-backend";
const BACKEND_PATH = BACKEND_DIRECTORY + "/" + BACKEND_EXECUTABLE;
const BUILD_ID_FILE = ".build-id";
const PROVISION_PATH = SDK_DIRECTORY + "/provision.sh";
// Empreinte du script de provisionnement réellement installé : il vit dans l'image, donc
// une correction apportée au script n'atteignait jamais un environnement déjà en place.
const PROVISION_ID_FILE = SDK_DIRECTORY + "/.provision-id";
const RELEASE_PATH = "/etc/sdk-manager-release";
const LINUX_WORKSPACE = "/home/sdk/Odoo-projects";
// Étapes de la préparation, dans leur ordre d'exécution. Windows ne publie aucun avancement
// pendant `wsl --import` : l'écran affiche l'étape en cours, pas un pourcentage inventé.
const PREPARE_STEP_LABELS = {
  import: "Installation de l'environnement Linux",
  backend: "Copie du gestionnaire",
  provision: "Configuration de Docker et Git",
  done: "Environnement prêt",
};
/**
 * Pourquoi l'environnement Linux n'a pas démarré, en une phrase actionnable.
 *
 * Une distribution installée peut cesser de démarrer du jour au lendemain : virtualisation
 * désactivée dans le BIOS, composant « Plateforme d'ordinateur virtuel » retiré, ou WSL
 * cassé par une mise à jour. Le gestionnaire repasse alors sur le backend Windows, et
 * l'utilisateur doit savoir pourquoi c'est devenu lent.
 */
function wslStartFailureReason(error) {
  const message = String(error?.message || error || "");
  if (/HCS_E_HYPERV_NOT_INSTALLED|0x80370102|virtualis/i.test(message)) {
    return (
      "La virtualisation est désactivée sur ce poste : WSL ne peut plus démarrer. Active-la dans le BIOS ou l'UEFI, " +
      "puis vérifie le composant Windows « Plateforme d'ordinateur virtuel »."
    );
  }
  if (/Wsl\/|wsl\.exe|WSL/i.test(message)) {
    return "WSL n'a pas pu démarrer sur ce poste. Le détail figure dans le journal du gestionnaire.";
  }
  return "";
}

/**
 * Dossier de projets de l'ancien backend Windows, tel qu'il le résolvait lui-même.
 *
 * `config.json` n'est écrit qu'au premier enregistrement des réglages : un poste resté sur le
 * dossier par défaut n'a ni le fichier ni la clé `workspace`, et la migration n'y trouvait
 * aucun projet, sans rien dire. Même ordre de recherche que `workspace_candidates` côté Python.
 */
function legacyWindowsWorkspace({ configText = "", home = "", exists = fs.existsSync } = {}) {
  let configured = "";
  try {
    configured = String(JSON.parse(configText || "{}").workspace || "").trim();
  } catch {
    configured = "";
  }
  if (configured) return configured;
  if (!home) return "";
  const candidates = [
    path.win32.join(home, "Documents", "Developer", "Odoo-projects"),
    path.win32.join(home, "Documents", "Odoo-projects"),
    path.win32.join(home, "Odoo-projects"),
  ];
  return candidates.find((candidate) => exists(candidate)) || "";
}

// Clés recherchées dans %USERPROFILE%\.ssh, dans l'ordre de préférence de ssh-keygen.
const SSH_KEY_NAMES = ["id_ed25519", "id_ecdsa", "id_rsa"];
// wsl.exe écrit ses listes en UTF-16LE, y compris dans un tube.
const WSL_ENCODING = "utf16le";

function decodeWslOutput(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "binary");
  const text = buffer.includes(0) ? buffer.toString(WSL_ENCODING) : buffer.toString("utf8");
  return text.replace(/^\uFEFF/, "").replace(/\r/g, "");
}

function parseDistributions(output) {
  return decodeWslOutput(output)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseWslVersion(output) {
  const match = decodeWslOutput(output).match(/(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? match[0] : "";
}

function supportsFileImport(version) {
  // `wsl --install --from-file` et `--name` datent de WSL 2.4.4.
  const parts = String(version || "")
    .split(".")
    .map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return false;
  const [major, minor, patch] = parts;
  if (major !== 2) return major > 2;
  if (minor !== 4) return minor > 4;
  return patch >= 4;
}

function importArguments({ archive, distribution = DISTRIBUTION, location }) {
  return ["--install", "--from-file", archive, "--name", distribution, "--location", location, "--no-launch"];
}

function backendCommand({ distribution = DISTRIBUTION, port, instance, logLevel, legacyWorkspace } = {}) {
  // `wsl.exe --exec` ne transmet aucune variable d'environnement de Windows : les
  // réglages du backend passent par `env`. Tuer wsl.exe arrête le processus Linux,
  // ce qui interdit un backend orphelin.
  const variables = [`ODOO_GUI_HOST=127.0.0.1`, `ODOO_GUI_PORT=${port}`];
  if (instance) variables.push(`ODOO_MANAGER_INSTANCE_ID=${instance}`);
  if (logLevel) variables.push(`ODOO_MANAGER_LOG_LEVEL=${logLevel}`);
  // Ancien dossier de projets Windows, vu sous /mnt : le backend y propose la migration.
  if (legacyWorkspace) variables.push(`ODOO_MANAGER_LEGACY_WORKSPACE=${legacyWorkspace}`);
  return { executable: "wsl.exe", args: ["-d", distribution, "--exec", "env", ...variables, BACKEND_PATH] };
}

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(digest.digest("hex")));
  });
}

function expectedChecksum(text) {
  const match = String(text || "")
    .trim()
    .match(/^([0-9a-f]{64})\b/i);
  if (!match) throw new Error("Fichier d'empreinte illisible.");
  return match[1].toLowerCase();
}

function imageFiles(resourcesRoot, version) {
  const archive = path.join(resourcesRoot, "wsl", `sdk-manager-${version}.wsl`);
  // Le script de provisionnement est livré à côté de l'image : il suit les builds, comme le
  // backend, au lieu d'être figé dans la distribution importée.
  return { archive, checksum: archive + ".sha256", provisionScript: path.join(resourcesRoot, "wsl", "provision.sh") };
}

class WslEnvironment {
  constructor({
    distribution = DISTRIBUTION,
    installRoot,
    runner = defaultRunner,
    log = () => {},
    mountPath = WslEnvironment.mountedWindowsPath,
    onProgress = () => {},
  } = {}) {
    this.distribution = distribution;
    this.installRoot = installRoot;
    this.run = runner;
    this.log = log;
    this.mountPath = mountPath;
    this.onProgress = onProgress;
  }

  async wslVersion() {
    try {
      const { stdout } = await this.run("wsl.exe", ["--version"]);
      return parseWslVersion(stdout);
    } catch {
      return "";
    }
  }

  async distributions() {
    try {
      const { stdout } = await this.run("wsl.exe", ["--list", "--quiet"]);
      return parseDistributions(stdout);
    } catch {
      return [];
    }
  }

  async installedRelease() {
    try {
      const { stdout } = await this.runInDistribution(["cat", RELEASE_PATH]);
      return decodeWslOutput(stdout).trim();
    } catch {
      return "";
    }
  }

  /** État complet, sans rien modifier : c'est ce que l'écran d'installation affiche. */
  async status() {
    const version = await this.wslVersion();
    const names = version ? await this.distributions() : [];
    const installed = names.some((name) => name.toLowerCase() === this.distribution.toLowerCase());
    return {
      wslInstalled: Boolean(version),
      wslVersion: version,
      supportsFileImport: supportsFileImport(version),
      distribution: this.distribution,
      distributionInstalled: installed,
      release: installed ? await this.installedRelease() : "",
    };
  }

  runInDistribution(command, options = {}) {
    const user = options.asRoot ? ["-u", "root"] : [];
    return this.run("wsl.exe", ["-d", this.distribution, ...user, "--exec", ...command], options);
  }

  /** Installe WSL lui-même. Une seule élévation, et Windows peut demander un redémarrage. */
  async installWsl() {
    const { stdout, stderr, code } = await this.run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$p = Start-Process -FilePath wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
      ],
      { allowFailure: true },
    );
    const output = decodeWslOutput(stdout) + decodeWslOutput(stderr);
    const rebootRequired = code !== 0 || /redémarr|restart/i.test(output);
    this.log(`Installation de WSL: code ${code}. ${output.trim()}`);
    return { ok: code === 0, rebootRequired, message: output.trim() };
  }

  /** Importe l'image, après vérification de son empreinte. */
  async importDistribution({ archive, checksum }) {
    const expected = expectedChecksum(fs.readFileSync(checksum, "utf8"));
    const actual = await sha256OfFile(archive);
    if (actual !== expected) {
      throw new Error("L'image de l'environnement ne correspond pas à son empreinte : installation refusée.");
    }
    fs.mkdirSync(this.installRoot, { recursive: true });
    await this.run(
      "wsl.exe",
      importArguments({
        archive,
        distribution: this.distribution,
        location: this.installRoot,
      }),
    );
    // Disque creux : l'espace libéré dans la distribution revient à Windows.
    await this.run("wsl.exe", ["--manage", this.distribution, "--set-sparse", "true"], { allowFailure: true });
    this.log(`Environnement ${this.distribution} installé dans ${this.installRoot}.`);
  }

  /**
   * Copie le backend Linux (exécutable et dossier de runtime) dans la distribution.
   *
   * La copie passe par le montage /mnt des disques Windows. Elle est préparée à côté puis
   * permutée : une mise à jour interrompue laisse l'ancien backend intact. Le chemin source
   * est un argument, jamais interpolé dans le script.
   */
  async installBackend(source) {
    const mounted = this.mountPath(source);
    if (!mounted) throw new Error(`Backend Linux introuvable : ${source}`);
    const buildId = await sha256OfFile(path.join(source, BACKEND_EXECUTABLE));
    const script = [
      "set -eu",
      `rm -rf ${BACKEND_DIRECTORY}.tmp`,
      `mkdir -p ${BACKEND_DIRECTORY}.tmp`,
      `cp -R "$1"/. ${BACKEND_DIRECTORY}.tmp/`,
      `chmod 0755 ${BACKEND_DIRECTORY}.tmp/${BACKEND_EXECUTABLE}`,
      `printf '%s\\n' "$2" > ${BACKEND_DIRECTORY}.tmp/${BUILD_ID_FILE}`,
      `rm -rf ${BACKEND_DIRECTORY}`,
      `mv ${BACKEND_DIRECTORY}.tmp ${BACKEND_DIRECTORY}`,
      // Emplacement des versions précédentes : fichier unique directement dans /opt/sdk-manager.
      `rm -f ${SDK_DIRECTORY}/${BACKEND_EXECUTABLE}`,
    ].join("\n");
    await this.runInDistribution(["sh", "-c", script, "install-backend", mounted, buildId], { asRoot: true });
    this.log(`Backend installé dans l'environnement (${buildId.slice(0, 12)}).`);
  }

  async installedBackendId() {
    try {
      const { stdout } = await this.runInDistribution(["cat", `${BACKEND_DIRECTORY}/${BUILD_ID_FILE}`]);
      return decodeWslOutput(stdout).trim();
    } catch {
      return "";
    }
  }

  async installedProvisionId() {
    try {
      const { stdout } = await this.runInDistribution(["cat", PROVISION_ID_FILE]);
      return decodeWslOutput(stdout).trim();
    } catch {
      return "";
    }
  }

  /**
   * Met la distribution au niveau de ce build. Rejouable.
   *
   * Le script du build remplace celui de l'image avant d'être exécuté : sans cela, un
   * environnement installé une fois gardait éternellement l'ancien provisionnement.
   */
  async provision(version, script = "", scriptId = "") {
    if (script) {
      const mounted = this.mountPath(script);
      if (!mounted) throw new Error(`Script de provisionnement introuvable : ${script}`);
      const copy = [
        "set -eu",
        `mkdir -p ${SDK_DIRECTORY}`,
        `cp -- "$1" ${PROVISION_PATH}.tmp`,
        `chmod 0755 ${PROVISION_PATH}.tmp`,
        `mv ${PROVISION_PATH}.tmp ${PROVISION_PATH}`,
      ].join("\n");
      await this.runInDistribution(["sh", "-c", copy, "install-provision", mounted], { asRoot: true });
    }
    await this.runInDistribution(["env", `SDK_MANAGER_VERSION=${version}`, "sh", PROVISION_PATH], { asRoot: true });
    if (scriptId) {
      await this.runInDistribution(
        ["sh", "-c", `printf '%s\\n' "$1" > ${PROVISION_ID_FILE}`, "write-provision-id", scriptId],
        { asRoot: true },
      );
    }
    this.log(`Environnement provisionné en version ${version}.`);
  }

  /**
   * Prépare l'environnement pour ce build, sans jamais réimporter la distribution.
   *
   * Le backend est comparé par l'empreinte de son exécutable, pas par le numéro de version :
   * deux builds d'une même version (0.5.0-build8, build9…) embarquent des backends différents.
   */
  async prepare({ version, backendSource, archive, checksum, provisionScript = "" }) {
    const state = await this.status();
    if (!state.wslInstalled) throw new Error("WSL n'est pas installé.");
    // Le plan est établi avant d'agir : l'écran annonce le nombre d'étapes dès le départ,
    // au lieu de laisser l'utilisateur devant une attente de durée inconnue.
    const expected = await sha256OfFile(path.join(backendSource, BACKEND_EXECUTABLE));
    // Le provisionnement suit la version ET le script : deux builds d'une même version peuvent
    // corriger l'environnement, et cette correction doit atteindre les postes déjà installés.
    const provisionId = provisionScript ? await sha256OfFile(provisionScript) : "";
    const provisionOutdated =
      state.release !== version || (provisionId !== "" && (await this.installedProvisionId()) !== provisionId);
    const planned = !state.distributionInstalled
      ? ["import", "backend", "provision"]
      : [
          (await this.installedBackendId()) !== expected ? "backend" : null,
          provisionOutdated ? "provision" : null,
        ].filter(Boolean);
    const run = async (step, action) => {
      const index = planned.indexOf(step);
      if (index < 0) return;
      this.onProgress({ step, label: PREPARE_STEP_LABELS[step], index: index + 1, total: planned.length });
      await action();
    };

    await run("import", () => this.importDistribution({ archive, checksum }));
    await run("backend", () => this.installBackend(backendSource));
    await run("provision", () => this.provision(version, provisionScript, provisionId));
    this.onProgress({ step: "done", label: PREPARE_STEP_LABELS.done, index: planned.length, total: planned.length });
    return this.status();
  }

  backendCommand(port, instance, legacyWorkspace = "") {
    return backendCommand({ distribution: this.distribution, port, instance, legacyWorkspace });
  }

  /**
   * Copie la clé SSH GitLab de Windows dans l'environnement, sur demande de l'utilisateur.
   *
   * La clé reste sur le poste. Une clé déjà présente dans l'environnement n'est jamais
   * écrasée ; la clé privée y est lisible par le seul utilisateur `sdk` (0600).
   */
  async importSshKey(windowsSshDirectory) {
    const name = SSH_KEY_NAMES.find(
      (candidate) =>
        fs.existsSync(path.join(windowsSshDirectory, candidate)) &&
        fs.existsSync(path.join(windowsSshDirectory, candidate + ".pub")),
    );
    if (!name) throw new Error(`Aucune paire de clés SSH dans ${windowsSshDirectory}.`);
    const privateKey = this.mountPath(path.join(windowsSshDirectory, name));
    const publicKey = this.mountPath(path.join(windowsSshDirectory, name + ".pub"));
    if (!privateKey || !publicKey) throw new Error(`Clé SSH hors d'un disque Windows : ${windowsSshDirectory}.`);
    const script = [
      "set -eu",
      "install -d -m 0700 -o sdk -g sdk /home/sdk/.ssh",
      // La même clé déjà en place n'est pas une erreur : un second clic la confirme.
      'if [ -e "/home/sdk/.ssh/$3" ]; then',
      '  if cmp -s "$1" "/home/sdk/.ssh/$3"; then echo already; exit 0; fi',
      "  echo \"Une autre clé $3 existe déjà dans l'environnement : elle n'est pas remplacée.\" >&2; exit 3",
      "fi",
      'install -m 0600 -o sdk -g sdk "$1" "/home/sdk/.ssh/$3"',
      'install -m 0644 -o sdk -g sdk "$2" "/home/sdk/.ssh/$3.pub"',
    ].join("\n");
    const { stdout } = await this.runInDistribution(
      ["sh", "-c", script, "import-ssh-key", privateKey, publicKey, name],
      { asRoot: true },
    );
    const alreadyPresent = decodeWslOutput(stdout).trim() === "already";
    this.log(
      alreadyPresent
        ? `Clé SSH ${name} déjà présente dans l'environnement.`
        : `Clé SSH ${name} copiée dans l'environnement.`,
    );
    return { ok: true, key: name, alreadyPresent };
  }

  async openEditor(projectPath) {
    // VS Code ouvre le dossier dans la distribution, pas à travers \\wsl.localhost.
    return this.run("code.cmd", ["--remote", `wsl+${this.distribution}`, projectPath], { allowFailure: true });
  }

  /** Chemin Linux du dossier de projets Windows, pour proposer la migration. */
  static mountedWindowsPath(windowsPath) {
    const match = /^([A-Za-z]):[\\/](.*)$/.exec(String(windowsPath || ""));
    if (!match) return "";
    return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`.replace(/\/+$/, "");
  }

  explorerPath(linuxPath) {
    const relative = String(linuxPath || "/")
      .replace(/^\//, "")
      .replace(/\//g, "\\");
    return `\\\\wsl.localhost\\${this.distribution}\\${relative}`;
  }
}

function defaultRunner(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { windowsHide: true, encoding: "buffer", maxBuffer: 8 * 1024 * 1024, timeout: options.timeout ?? 600000 },
      (error, stdout, stderr) => {
        const code = error?.code ?? 0;
        if (error && !options.allowFailure) {
          const detail = decodeWslOutput(stderr) || decodeWslOutput(stdout) || error.message;
          reject(new Error(detail.trim() || error.message));
          return;
        }
        resolve({ stdout, stderr, code });
      },
    );
  });
}

module.exports = {
  BACKEND_PATH,
  DISTRIBUTION,
  LINUX_WORKSPACE,
  WslEnvironment,
  backendCommand,
  PREPARE_STEP_LABELS,
  wslStartFailureReason,
  legacyWindowsWorkspace,
  decodeWslOutput,
  expectedChecksum,
  imageFiles,
  importArguments,
  parseDistributions,
  parseWslVersion,
  supportsFileImport,
};
