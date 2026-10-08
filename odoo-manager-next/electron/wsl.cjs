"use strict";
// Environnement Linux du gestionnaire sous Windows.
//
// Les projets servis depuis C:\ traversent le pont 9P de Docker Desktop : Odoo met
// 48 à 95 s à démarrer, contre 4 à 6 s sur un système de fichiers Linux. Le
// gestionnaire installe donc sa propre distribution WSL, y lance le backend, et
// l'utilisateur n'ouvre jamais de terminal.
const fs = require("node:fs");
const os = require("node:os");
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
// Démarrage de Linux vérifié avant le plan : absent de la barre d'avancement, présent au journal.
const WAKE_LABEL = "Démarrage de l'environnement Linux";
// Disques d'imports interrompus : gardés ce temps-là après une installation réussie, puis supprimés.
const ORPHAN_DISK_PREFIX = "ext4.vhdx.interrompu-";
const ORPHAN_DISK_RETENTION_MS = 14 * 24 * 3600_000;
// Commandes de la préparation, reconnues à leur nom (`$0` des scripts) : un essai abandonné après
// un délai dépassé peut encore tourner quand Linux n'a pas pu être redémarré.
const LEFTOVER_PATTERN = "install-backend|install-provision|write-provision-id|/opt/sdk-manager/provision\\.sh";
// En dessous, la préparation est lente ou échoue : l'écran le dit avant de commencer.
const LOW_FREE_MEMORY = 1024 ** 3;
// Délais des commandes WSL. Un démarrage de Linux bloqué attendait auparavant les 10 minutes
// par défaut à chaque lecture, puis l'écran affichait la commande au lieu de reprendre seul.
const TIMEOUTS = {
  // Démarrage de la distribution et petites lectures : quelques secondes d'habitude.
  wake: 3 * 60_000,
  // `wsl --terminate`, `--shutdown`, `--unregister`.
  control: 2 * 60_000,
  // Import de l'image : plusieurs minutes sur un disque lent, antivirus compris.
  import: 30 * 60_000,
  // Copie du backend par /mnt, provisionnement (démarrage de Docker).
  step: 15 * 60_000,
};
// Erreurs de Windows quand la virtualisation manque, en français comme en anglais
// (« virtualisation », « virtualization ») : aucun nouvel essai n'y changerait rien.
const VIRTUALIZATION_ERROR = /HCS_E_HYPERV_NOT_INSTALLED|0x80370102|virtuali[sz]ation/i;

function isVirtualizationError(error) {
  return VIRTUALIZATION_ERROR.test(String(error?.message || error || ""));
}

// Interroge le processeur et Windows. Un hyperviseur déjà actif (WSL, Hyper-V) masque l'option
// du BIOS : `VirtualizationFirmwareEnabled` vaut alors faux, d'où la lecture de `HypervisorPresent`.
const VIRTUALIZATION_PROBE =
  "$c = Get-CimInstance Win32_ComputerSystem; " +
  "$p = @(Get-CimInstance Win32_Processor | ForEach-Object { $_.VirtualizationFirmwareEnabled }); " +
  "[pscustomobject]@{ hypervisor = $c.HypervisorPresent; firmware = $p } | ConvertTo-Json -Compress";

/**
 * État de la virtualisation : `enabled`, `disabled`, ou `unknown` quand la réponse est illisible.
 *
 * `disabled` exige une réponse nette : un poste dont le processeur ne renseigne pas l'option
 * (null) n'est jamais bloqué sur une supposition.
 */
function parseVirtualization(output) {
  let probe;
  try {
    probe = JSON.parse(decodeWslOutput(output).trim());
  } catch {
    return "unknown";
  }
  const firmware = [].concat(probe?.firmware ?? []);
  if (probe?.hypervisor === true || firmware.includes(true)) return "enabled";
  if (probe?.hypervisor === false && firmware.length > 0 && firmware.every((value) => value === false)) {
    return "disabled";
  }
  return "unknown";
}

const VIRTUALIZATION_DISABLED_MESSAGE =
  "La virtualisation est désactivée sur ce poste : l'environnement Linux ne peut pas démarrer sans elle.";

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
  if (isVirtualizationError(message)) {
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

const GIB = 1024 ** 3;
// Tailles de .wslconfig : « 8GB », « 8192MB », « 512M »…
const WSL_SIZE = /^(\d+(?:\.\d+)?)\s*([KMGT]?)B?$/i;
const WSL_SIZE_UNITS = { "": 1, K: 1024, M: 1024 ** 2, G: GIB, T: 1024 ** 4 };

/** Taille d'un réglage de .wslconfig en octets, 0 si elle est illisible. */
function parseWslSize(value) {
  const match = WSL_SIZE.exec(String(value ?? "").trim());
  return match ? Number(match[1]) * WSL_SIZE_UNITS[match[2].toUpperCase()] : 0;
}

/**
 * Ressources demandées par l'interface, vérifiées : jamais plus que l'ordinateur n'en a.
 * La mémoire et le swap sont des Go entiers, comme les écrit le calcul de la recommandation.
 */
function wslResourcesRequest(value, { totalMemory = os.totalmem(), cpuCount = os.cpus().length } = {}) {
  const memory = Number(value?.memory);
  const cpus = Number(value?.cpus);
  const swap = Number(value?.swap);
  if (!Number.isInteger(memory / GIB) || memory < 2 * GIB || memory > totalMemory)
    throw new Error("Mémoire demandée invalide.");
  if (!Number.isInteger(cpus) || cpus < 1 || cpus > cpuCount) throw new Error("Nombre de processeurs invalide.");
  if (!Number.isInteger(swap / GIB) || swap < 0 || swap > 64 * GIB) throw new Error("Swap demandé invalide.");
  return { memory, cpus, swap };
}

/**
 * Contenu de .wslconfig avec la mémoire, les processeurs et le swap dans [wsl2], le reste intact.
 *
 * Une valeur déjà plus grande, posée par l'utilisateur ou un autre outil, est gardée : le réglage
 * n'enlève jamais de ressources. Les autres réglages et les commentaires sont conservés.
 */
function mergeWslConfig(text, { memory, cpus, swap }) {
  const lines = String(text || "").split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const wanted = [
    ["memory", `${memory / GIB}GB`, memory, parseWslSize],
    ["processors", String(cpus), cpus, (value) => Number.parseInt(value, 10) || 0],
    ["swap", `${swap / GIB}GB`, swap, parseWslSize],
  ];
  let start = lines.findIndex((line) => /^\s*\[wsl2\]\s*$/i.test(line));
  if (start < 0) {
    if (lines.length) lines.push("");
    lines.push("[wsl2]");
    start = lines.length - 1;
  }
  const sectionEnd = () => {
    const next = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
    let end = next < 0 ? lines.length : next;
    // Les nouvelles lignes vont après le dernier réglage de la section, pas après ses lignes vides.
    while (end - 1 > start && !lines[end - 1].trim()) end -= 1;
    return end;
  };
  for (const [key, written, bytes, parse] of wanted) {
    const end = sectionEnd();
    const pattern = new RegExp(`^\\s*${key}\\s*=\\s*([^#;]*)`, "i");
    const index = lines.findIndex((line, position) => position > start && position < end && pattern.test(line));
    if (index < 0) lines.splice(end, 0, `${key}=${written}`);
    else if (parse(pattern.exec(lines[index])[1].trim()) < bytes) lines[index] = `${key}=${written}`;
  }
  // Fichier Windows : fins de ligne Windows.
  return lines.join("\r\n") + "\r\n";
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

function backendCommand({
  distribution = DISTRIBUTION,
  port,
  instance,
  logLevel,
  legacyWorkspace,
  hostMemory,
  hostCpus,
} = {}) {
  // `wsl.exe --exec` ne transmet que les variables Windows listées dans WSLENV : les
  // réglages du backend passent par `env`. Le jeton de l'API, secret, passe seul par
  // WSLENV (voir Backend.launch) pour ne pas figurer dans la ligne de commande.
  // Tuer wsl.exe arrête le processus Linux, ce qui interdit un backend orphelin.
  const variables = [`ODOO_GUI_HOST=127.0.0.1`, `ODOO_GUI_PORT=${port}`];
  if (instance) variables.push(`ODOO_MANAGER_INSTANCE_ID=${instance}`);
  if (logLevel) variables.push(`ODOO_MANAGER_LOG_LEVEL=${logLevel}`);
  // Ancien dossier de projets Windows, vu sous /mnt : le backend y propose la migration.
  if (legacyWorkspace) variables.push(`ODOO_MANAGER_LEGACY_WORKSPACE=${legacyWorkspace}`);
  // Dans WSL, le backend ne voit que la machine virtuelle : la mémoire et les processeurs de
  // l'ordinateur viennent d'ici, pour recommander la part à donner à Docker.
  if (hostMemory) variables.push(`ODOO_MANAGER_HOST_MEMORY=${hostMemory}`);
  if (hostCpus) variables.push(`ODOO_MANAGER_HOST_CPUS=${hostCpus}`);
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
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    memory = () => ({ total: os.totalmem(), free: os.freemem() }),
    now = () => Date.now(),
  } = {}) {
    this.distribution = distribution;
    this.installRoot = installRoot;
    this.run = runner;
    this.log = log;
    this.mountPath = mountPath;
    this.onProgress = onProgress;
    this.sleep = sleep;
    this.memory = memory;
    this.now = now;
    // Dernière étape annoncée : un écran ouvert en cours de route reprend l'avancement là.
    this.progress = null;
    // Préparation en cours, partagée : celle du démarrage et le clic sur « Préparer mon poste »
    // copiaient le même backend et le même script au même endroit, en même temps.
    this.preparing = null;
    // La virtualisation ne s'active qu'au redémarrage : une fois constatée, elle n'est plus relue.
    this.virtualizationEnabled = false;
  }

  /** Annonce une étape, et la garde pour un écran qui s'ouvrirait pendant la préparation. */
  report(progress) {
    this.progress = progress;
    this.onProgress(progress);
  }

  /** Préparation en cours et son étape, sans lancer aucune commande : l'écran de chargement l'interroge souvent. */
  preparation() {
    return { preparing: Boolean(this.preparing), progress: this.preparing ? this.progress : null };
  }

  /** La virtualisation du processeur est-elle active ? Lue avant l'import, qui en dépend. */
  async virtualization() {
    if (this.virtualizationEnabled) return "enabled";
    let state = "unknown";
    try {
      const { stdout } = await this.run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", VIRTUALIZATION_PROBE],
        {
          timeout: TIMEOUTS.control,
        },
      );
      state = parseVirtualization(stdout);
    } catch {
      state = "unknown";
    }
    this.virtualizationEnabled = state === "enabled";
    return state;
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

  /**
   * La distribution est-elle inscrite ? Sans tolérance : une liste illisible lève une erreur.
   *
   * `distributions()` rend une liste vide quand `wsl --list` échoue ; s'y fier avant de
   * désinscrire, c'était risquer d'effacer un environnement existant et ses projets.
   */
  async isRegistered() {
    const { stdout } = await this.run("wsl.exe", ["--list", "--quiet"], { timeout: TIMEOUTS.control });
    return parseDistributions(stdout).some((name) => name.toLowerCase() === this.distribution.toLowerCase());
  }

  /**
   * Met de côté le disque d'un import interrompu, que Windows refuserait d'écraser.
   *
   * Appelé seulement quand la distribution n'est pas inscrite. Le disque est renommé, pas
   * supprimé : s'il contenait malgré tout des projets, ils restent récupérables 14 jours.
   */
  setAsideOrphanDisk() {
    const disk = path.join(this.installRoot, "ext4.vhdx");
    if (!fs.existsSync(disk)) return;
    const kept = path.join(this.installRoot, `${ORPHAN_DISK_PREFIX}${this.now()}`);
    fs.renameSync(disk, kept);
    this.log(`Disque d'un import inachevé mis de côté : ${kept}.`);
  }

  /** Supprime, après une installation réussie, les disques mis de côté depuis plus de 14 jours. */
  removeOldOrphanDisks() {
    let names = [];
    try {
      names = fs.readdirSync(this.installRoot);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.startsWith(ORPHAN_DISK_PREFIX)) continue;
      const setAsideAt = Number(name.slice(ORPHAN_DISK_PREFIX.length));
      if (!Number.isFinite(setAsideAt) || this.now() - setAsideAt < ORPHAN_DISK_RETENTION_MS) continue;
      try {
        fs.rmSync(path.join(this.installRoot, name), { force: true });
        this.log(`Ancien disque d'import inachevé supprimé : ${name}.`);
      } catch (error) {
        this.log(`Ancien disque ${name} non supprimé : ${error.message}`);
      }
    }
  }

  /** Arrête ce qui reste d'un essai abandonné, quand Linux ne peut pas être redémarré. */
  async stopLeftovers() {
    await this.runInDistribution(["pkill", "-f", "--", LEFTOVER_PATTERN], {
      asRoot: true,
      allowFailure: true,
      timeout: TIMEOUTS.wake,
    });
  }

  async installedRelease() {
    try {
      const { stdout } = await this.runInDistribution(["cat", RELEASE_PATH], { timeout: TIMEOUTS.wake });
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
      // Lue seulement avant l'installation : une distribution déjà installée prouve qu'elle
      // démarrait, et un arrêt ultérieur est expliqué par la bascule sur le backend Windows.
      virtualization: installed ? "unknown" : await this.virtualization(),
      memory: this.memory(),
      ...this.preparation(),
    };
  }

  runInDistribution(command, options = {}) {
    const user = options.asRoot ? ["-u", "root"] : [];
    return this.run("wsl.exe", ["-d", this.distribution, ...user, "--exec", ...command], options);
  }

  /** Démarre la distribution, avec un délai court : un Linux bloqué au démarrage est repéré vite. */
  async wake() {
    await this.runInDistribution(["true"], { timeout: TIMEOUTS.wake });
  }

  /** Arrête la distribution du gestionnaire seule, sans toucher aux autres distributions du poste. */
  async restartDistribution() {
    this.log(`Redémarrage de l'environnement ${this.distribution}.`);
    await this.run("wsl.exe", ["--terminate", this.distribution], { allowFailure: true, timeout: TIMEOUTS.control });
    await this.sleep(3000);
    return true;
  }

  /**
   * Arrête tout WSL, ce que fait un redémarrage de l'ordinateur, mais seulement si aucune autre
   * distribution ne tourne : Docker Desktop ou un Ubuntu ouvert par l'utilisateur seraient coupés.
   */
  async restartWsl() {
    let running = [];
    try {
      const { stdout } = await this.run("wsl.exe", ["--list", "--running", "--quiet"], { timeout: TIMEOUTS.control });
      running = parseDistributions(stdout);
    } catch {
      running = [];
    }
    const others = running.filter((name) => name.toLowerCase() !== this.distribution.toLowerCase());
    if (others.length) {
      this.log(`WSL n'est pas redémarré : d'autres distributions tournent (${others.join(", ")}).`);
      return false;
    }
    this.log("Redémarrage complet de WSL.");
    await this.run("wsl.exe", ["--shutdown"], { allowFailure: true, timeout: TIMEOUTS.control });
    await this.sleep(5000);
    return true;
  }

  /**
   * Exécute une étape, et la rejoue quand une commande WSL a échoué : délai dépassé, Linux arrêté
   * en cours de route (mémoire saturée, mise en veille de la distribution), sortie inattendue.
   *
   * Seules les commandes sont rejouées (`error.command`) : une image corrompue ou un fichier
   * absent échouerait à l'identique. Chaque nouvel essai part d'un Linux redémarré, sauf quand
   * le backend y tourne déjà : le couper laisserait l'application sans backend. Les restes de
   * l'essai précédent sont alors arrêtés un par un.
   */
  async withRecovery(step, action, { restartAllowed = true } = {}) {
    const label = PREPARE_STEP_LABELS[step] || WAKE_LABEL;
    const recoveries = restartAllowed
      ? [() => this.restartDistribution(), () => this.restartWsl()]
      : [
          async () => {
            await this.stopLeftovers();
            await this.sleep(5000);
            return true;
          },
        ];
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await action(attempt);
      } catch (error) {
        // Virtualisation absente : seul l'utilisateur peut l'activer, un nouvel essai serait vain.
        if (!error?.command || isVirtualizationError(error) || attempt >= recoveries.length) throw error;
        this.log(`Étape « ${label} » interrompue (${error.message}) : nouvel essai.`);
        if (!(await recoveries[attempt]())) throw error;
        // L'écran dit qu'un nouvel essai est en cours, au lieu d'une barre qui semble figée.
        this.report({
          ...(this.progress || { step, index: 0, total: 0 }),
          label: `Nouvel essai : ${label}`,
          retry: attempt + 1,
        });
      }
    }
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
    let alreadyRegistered = false;
    await this.withRecovery("import", async (attempt) => {
      if (await this.isRegistered()) {
        // Au premier essai, une distribution inscrite est celle de l'utilisateur, que la liste
        // n'avait pas montrée : elle n'est jamais remplacée.
        if (attempt === 0) {
          alreadyRegistered = true;
          return;
        }
        // Après un essai de cet import, c'est la distribution qu'il vient d'inscrire, encore vide.
        this.log(`Import précédent inachevé : ${this.distribution} est désinscrite avant un nouvel essai.`);
        await this.run("wsl.exe", ["--unregister", this.distribution], {
          allowFailure: true,
          timeout: TIMEOUTS.control,
        });
      }
      if (!(await this.isRegistered())) this.setAsideOrphanDisk();
      await this.run(
        "wsl.exe",
        importArguments({
          archive,
          distribution: this.distribution,
          location: this.installRoot,
        }),
        { timeout: TIMEOUTS.import },
      );
    });
    if (alreadyRegistered) {
      this.log(`Environnement ${this.distribution} déjà inscrit : import ignoré.`);
      return;
    }
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
    await this.runInDistribution(["sh", "-c", script, "install-backend", mounted, buildId], {
      asRoot: true,
      timeout: TIMEOUTS.step,
    });
    this.log(`Backend installé dans l'environnement (${buildId.slice(0, 12)}).`);
  }

  async installedBackendId() {
    try {
      const { stdout } = await this.runInDistribution(["cat", `${BACKEND_DIRECTORY}/${BUILD_ID_FILE}`], {
        timeout: TIMEOUTS.wake,
      });
      return decodeWslOutput(stdout).trim();
    } catch {
      return "";
    }
  }

  async installedProvisionId() {
    try {
      const { stdout } = await this.runInDistribution(["cat", PROVISION_ID_FILE], { timeout: TIMEOUTS.wake });
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
      await this.runInDistribution(["sh", "-c", copy, "install-provision", mounted], {
        asRoot: true,
        timeout: TIMEOUTS.step,
      });
    }
    await this.runInDistribution(["env", `SDK_MANAGER_VERSION=${version}`, "sh", PROVISION_PATH], {
      asRoot: true,
      timeout: TIMEOUTS.step,
    });
    if (scriptId) {
      await this.runInDistribution(
        ["sh", "-c", `printf '%s\\n' "$1" > ${PROVISION_ID_FILE}`, "write-provision-id", scriptId],
        { asRoot: true, timeout: TIMEOUTS.wake },
      );
    }
    this.log(`Environnement provisionné en version ${version}.`);
  }

  /**
   * Prépare l'environnement pour ce build, sans jamais réimporter la distribution.
   *
   * Le backend est comparé par l'empreinte de son exécutable, pas par le numéro de version :
   * deux builds d'une même version (0.5.0-build8, build9…) embarquent des backends différents.
   *
   * Un seul appel à la fois : un second appel pendant une préparation en reçoit le résultat.
   * `restartAllowed` est faux quand le backend tourne déjà dans la distribution.
   */
  prepare(options) {
    if (!this.preparing) {
      this.preparing = this.prepareOnce(options).finally(() => {
        this.preparing = null;
        this.progress = null;
      });
    }
    return this.preparing;
  }

  async prepareOnce({ version, backendSource, archive, checksum, provisionScript = "", restartAllowed = true }) {
    const state = await this.status();
    if (!state.wslInstalled) throw new Error("WSL n'est pas installé.");
    // Constatée avant l'import : sans elle, l'import échouait après la vérification de l'image.
    if (!state.distributionInstalled && state.virtualization === "disabled") {
      this.log(VIRTUALIZATION_DISABLED_MESSAGE);
      throw new Error(VIRTUALIZATION_DISABLED_MESSAGE);
    }
    if (state.memory.free < LOW_FREE_MEMORY) {
      this.log(`Peu de mémoire libre au début de la préparation : ${Math.round(state.memory.free / 1024 ** 2)} Mo.`);
    }
    const recovery = { restartAllowed };
    const failed = (label, error) => {
      // Le journal garde la cause technique et la commande ; l'écran reçoit une phrase simple.
      this.log(`Échec de l'étape « ${label} » : ${error.message}`);
      if (error.command) this.log(`  Commande : ${error.command}`);
      if (!error.command || isVirtualizationError(error)) return error;
      const plain = new Error(`La préparation s'est arrêtée à l'étape « ${label} » après plusieurs essais.`);
      plain.step = error.step;
      plain.cause = error;
      return plain;
    };
    // Linux bloqué au démarrage : repéré et relancé ici, avant les lectures qui fondent le plan.
    if (state.distributionInstalled) {
      await this.withRecovery("wake", () => this.wake(), recovery).catch((error) => {
        throw failed(WAKE_LABEL, error);
      });
    }
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
      this.report({ step, label: PREPARE_STEP_LABELS[step], index: index + 1, total: planned.length });
      try {
        await action();
      } catch (error) {
        error.step = step;
        throw failed(PREPARE_STEP_LABELS[step], error);
      }
    };

    // Les étapes suivantes sont rejouables : le backend est permuté d'un bloc, le
    // provisionnement vérifie chaque point avant d'agir.
    const recovered = (step, action) =>
      this.withRecovery(
        step,
        async () => {
          await this.wake();
          await action();
        },
        recovery,
      );
    await run("import", () => this.importDistribution({ archive, checksum }));
    await run("backend", () => recovered("backend", () => this.installBackend(backendSource)));
    await run("provision", () => recovered("provision", () => this.provision(version, provisionScript, provisionId)));
    this.report({ step: "done", label: PREPARE_STEP_LABELS.done, index: planned.length, total: planned.length });
    this.removeOldOrphanDisks();
    // Lu avant la fin de cet appel : sans cela, l'état rendu se dirait encore « en préparation ».
    return { ...(await this.status()), preparing: false, progress: null };
  }

  /**
   * Écrit dans .wslconfig la mémoire, les processeurs et le swap à donner à WSL, donc à Docker.
   *
   * Le fichier d'origine est copié une fois en `.sdk-manager.bak`, et remplacé d'un bloc.
   * WSL ne relit ce fichier qu'à son redémarrage : voir `shutdown`.
   */
  writeResources(resources, file) {
    let original = "";
    try {
      original = decodeWslOutput(fs.readFileSync(file)).replace(/\n/g, "\r\n");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const text = mergeWslConfig(original, resources);
    if (text === original) return false;
    const backup = file + ".sdk-manager.bak";
    if (original && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
    const temporary = file + ".sdk-manager.tmp";
    fs.writeFileSync(temporary, text, "utf8");
    fs.renameSync(temporary, file);
    this.log(`Ressources de WSL écrites dans ${file} : ${text.trim().replace(/\r?\n/g, " ")}`);
    return true;
  }

  /** Arrête tout WSL : au prochain démarrage, il relit .wslconfig. */
  async shutdown() {
    this.log("Arrêt de WSL pour appliquer ses nouvelles ressources.");
    await this.run("wsl.exe", ["--shutdown"], { allowFailure: true, timeout: TIMEOUTS.control });
  }

  backendCommand(port, instance, legacyWorkspace = "") {
    return backendCommand({
      distribution: this.distribution,
      port,
      instance,
      legacyWorkspace,
      hostMemory: os.totalmem(),
      hostCpus: os.cpus().length,
    });
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

/**
 * Erreur d'une commande échouée : sa sortie quand elle en a une, sinon comment elle s'est arrêtée.
 *
 * Node met la commande entière dans `error.message` : un script de dix lignes s'affichait à
 * l'écran à la place de la cause, sans le code de sortie ni le dépassement de délai. La commande
 * reste disponible pour le journal (`error.command`), jamais dans le message.
 */
function commandError(executable, error, stdout, stderr) {
  const output = decodeWslOutput(stderr).trim() || decodeWslOutput(stdout).trim();
  const name = path.win32.basename(String(executable));
  const stopped = () => {
    if (error?.killed) return `${name} n'a pas répondu dans le délai imparti.`;
    if (error?.signal) return `${name} a été interrompu (${error.signal}).`;
    if (typeof error?.code === "number") return `${name} s'est arrêté sans message (code ${error.code}).`;
    return String(error?.message || error || "").split("\n")[0];
  };
  const failure = new Error(output || stopped());
  failure.command = error?.cmd || name;
  return failure;
}

function defaultRunner(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { windowsHide: true, encoding: "buffer", maxBuffer: 8 * 1024 * 1024, timeout: options.timeout ?? 600000 },
      (error, stdout, stderr) => {
        // Délai dépassé ou processus tué : `error.code` est nul, ce qui passait pour un succès.
        const code = !error ? 0 : typeof error.code === "number" ? error.code : 1;
        if (error && !options.allowFailure) {
          reject(commandError(executable, error, stdout, stderr));
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
  mergeWslConfig,
  parseWslSize,
  wslResourcesRequest,
  commandError,
  decodeWslOutput,
  isVirtualizationError,
  parseVirtualization,
  expectedChecksum,
  imageFiles,
  importArguments,
  parseDistributions,
  parseWslVersion,
  supportsFileImport,
};
