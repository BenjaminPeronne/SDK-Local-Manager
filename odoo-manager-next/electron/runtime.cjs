const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { randomBytes, randomUUID, createHash } = require("node:crypto");

const APP_ORIGIN = "app://sdk";
const API_TOKEN_HEADER = "X-SDK-Manager-Token";
const API_TOKEN_VARIABLE = "ODOO_MANAGER_API_TOKEN";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function configPath(env = process.env, platform = process.platform, home = os.homedir()) {
  const expand = (value) => value.replace(/^~(?=$|[\\/])/, home);
  if (env.ODOO_MANAGER_CONFIG) return expand(env.ODOO_MANAGER_CONFIG);
  if (env.ODOO_MANAGER_CONFIG_DIR) return path.join(expand(env.ODOO_MANAGER_CONFIG_DIR), "config.json");
  const directory =
    platform === "darwin"
      ? path.join(home, "Library/Application Support/Odoo Manager")
      : platform === "win32"
        ? path.join(env.APPDATA || path.join(home, "AppData/Roaming"), "Odoo Manager")
        : path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "odoo-manager");
  return path.join(directory, "config.json");
}

function configuredPort(env = process.env) {
  try {
    const value = JSON.parse(fs.readFileSync(configPath(env), "utf8")).api_port;
    if (Number.isInteger(value) && value >= 1024 && value <= 65535) return value;
  } catch {
    /* First launch uses the established port. */
  }
  return 18765;
}

// Scripts et intégrateurs lisent le jeton de la session dans ce fichier, à côté de config.json.
function apiTokenPath(env = process.env) {
  return path.join(path.dirname(configPath(env)), "api-token");
}

// `wsl.exe` ne transmet à Linux que les variables Windows listées dans WSLENV. Passer le jeton
// ainsi, plutôt qu'en argument de la commande, le garde hors de la liste des processus.
function mergeWslenv(current, name) {
  const names = String(current || "")
    .split(":")
    .filter(Boolean);
  return names.some((entry) => entry.split("/")[0] === name) ? names.join(":") : [...names, name].join(":");
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const selected = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
}

async function selectPort(preferred) {
  try {
    return await reservePort(preferred);
  } catch {
    return reservePort(0);
  }
}

function externalUrl(value) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("URL invalide.");
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("URL non autorisée.");
  return url.href;
}

function staticPath(urlValue, root) {
  const url = new URL(urlValue);
  if (url.protocol !== "app:" || url.host !== "sdk") throw new Error("Origine non autorisée.");
  const relative = decodeURIComponent(url.pathname);
  if (relative.includes("\\") || relative.includes("\0")) throw new Error("Chemin invalide.");
  const target = path.resolve(root, "." + (relative === "/" ? "/index.html" : relative));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("Chemin non autorisé.");
  return target;
}

function contentPolicy(html, endpoint) {
  // Next export emits bootstrap scripts. Authorize their exact bytes, never arbitrary inline JS.
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[1])
    .map((match) => "'sha256-" + createHash("sha256").update(match[1]).digest("base64") + "'");
  return `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${endpoint}; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'`;
}

class Backend {
  // `command` remplace executable/args quand le backend tourne ailleurs que sur
  // Windows : dans la distribution WSL, la commande dépend du port retenu.
  constructor({
    executable,
    args = [],
    logDir,
    env = process.env,
    command = null,
    preferredPort = null,
    beforeStart = null,
    onFallback = null,
  }) {
    this.executable = executable;
    this.args = args;
    this.command = command;
    this.beforeStart = beforeStart;
    // Repli sur `executable` quand `command` échoue : l'environnement Linux installé peut
    // cesser de démarrer, et le backend natif reste utilisable.
    this.onFallback = onFallback;
    this.preferredPort = preferredPort;
    this.logDir = logDir;
    this.logPath = path.join(logDir, "backend.log");
    this.env = env;
    this.instance = randomUUID();
    // Tiré à chaque lancement : toute requête au backend doit le présenter.
    this.apiToken = randomBytes(32).toString("base64url");
    this.tokenPath = apiTokenPath(env);
    this.child = null;
    this.ready = false;
  }

  log(message) {
    fs.appendFileSync(this.logPath, message + "\n");
  }

  authorized(init = {}) {
    return { ...init, headers: { ...init.headers, [API_TOKEN_HEADER]: this.apiToken } };
  }

  // Écrit par renommage, lisible par le seul utilisateur : un fichier à moitié écrit n'est jamais lu.
  writeTokenFile() {
    try {
      fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
      const temporary = `${this.tokenPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, this.apiToken, { mode: 0o600 });
      fs.renameSync(temporary, this.tokenPath);
    } catch (error) {
      this.log(`Fichier du jeton de l'API non écrit : ${error.message}`);
    }
  }

  removeTokenFile() {
    try {
      // Une autre instance a pu le réécrire depuis : on ne supprime que le sien.
      if (fs.readFileSync(this.tokenPath, "utf8") === this.apiToken) fs.rmSync(this.tokenPath, { force: true });
    } catch {
      /* Déjà absent. */
    }
  }

  // Réserve le port et ouvre le journal, sans lancer le backend. La politique de sécurité de la
  // fenêtre et le pont `backend-endpoint` n'ont besoin que de l'adresse : la fenêtre peut donc
  // s'afficher pendant que le backend démarre, au lieu de l'attendre.
  async reserve() {
    if (this.endpoint) return this.endpoint;
    fs.mkdirSync(this.logDir, { recursive: true });
    if (fs.existsSync(this.logPath) && fs.statSync(this.logPath).size > 2_000_000) {
      fs.rmSync(path.join(this.logDir, "backend.previous.log"), { force: true });
      fs.renameSync(this.logPath, path.join(this.logDir, "backend.previous.log"));
    }
    this.port = await selectPort(this.preferredPort || configuredPort(this.env));
    this.endpoint = `http://127.0.0.1:${this.port}`;
    this.log(`\n=== SDK Local Manager Electron · ${new Date().toISOString()} · ${this.endpoint} ===`);
    return this.endpoint;
  }

  /**
   * Démarre le backend, et retombe sur l'exécutable natif si la commande dédiée échoue.
   *
   * Un poste dont la virtualisation vient d'être désactivée gardait une application inutilisable
   * alors que le backend Windows était installé à côté.
   */
  async start() {
    try {
      await this.launch();
    } catch (error) {
      if (!this.command || !this.onFallback) throw error;
      this.log(error.stack || error.message);
      this.command = null;
      this.beforeStart = null;
      this.error = null;
      this.onFallback(error);
      await this.launch();
    }
  }

  async launch() {
    await this.reserve();
    // Préparation de l'environnement du backend (distribution WSL) : la fenêtre, elle, est déjà affichée.
    if (this.beforeStart) await this.beforeStart();
    const fd = fs.openSync(this.logPath, "a");
    try {
      const target = this.command
        ? this.command(this.port, this.instance)
        : { executable: this.executable, args: this.args };
      this.child = spawn(target.executable, target.args, {
        env: {
          ...this.env,
          ODOO_GUI_HOST: "127.0.0.1",
          ODOO_GUI_PORT: String(this.port),
          ODOO_MANAGER_LOG_DIR: this.logDir,
          ODOO_MANAGER_INSTANCE_ID: this.instance,
          [API_TOKEN_VARIABLE]: this.apiToken,
          ...(process.platform === "win32" ? { WSLENV: mergeWslenv(this.env.WSLENV, API_TOKEN_VARIABLE) } : {}),
        },
        windowsHide: true,
        stdio: ["ignore", fd, fd],
      });
      this.child.on("error", (error) => {
        this.error = error;
        this.log(error.message);
      });
    } finally {
      fs.closeSync(fd);
    }
    // Le backend répond en ~0,1 s : un pas fixe de 250 ms doublait ce délai. Le pas s'allonge
    // ensuite pour ne pas marteler un backend lent, à budget total inchangé.
    const deadline = Date.now() + 30_000;
    for (let step = 25; Date.now() < deadline; step = Math.min(step * 2, 250)) {
      if (this.error) throw this.error;
      if (this.child.exitCode !== null) throw new Error(`Le backend s’est arrêté (code ${this.child.exitCode}).`);
      try {
        const response = await fetch(
          this.endpoint + "/api/health",
          this.authorized({ signal: AbortSignal.timeout(500) }),
        );
        const health = await response.json();
        if (response.ok && health.ok && health.instance_id === this.instance) {
          this.ready = true;
          this.writeTokenFile();
          this.log("Backend opérationnel et identité vérifiée.");
          return;
        }
      } catch {
        /* Backend initialization may take several seconds. */
      }
      await sleep(step);
    }
    throw new Error("Le backend ne répond pas après le démarrage. Consultez le journal.");
  }

  diagnostics() {
    let details = "Journal indisponible.";
    try {
      details = fs.readFileSync(this.logPath, "utf8").slice(-16000);
    } catch {
      /* absent */
    }
    return { log_path: this.logPath, details };
  }

  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.terminate();
    return this.stopping;
  }

  async terminate() {
    const child = this.child;
    this.removeTokenFile();
    if (!child || child.exitCode !== null || this.error) return;
    // Never send shutdown to a different instance that acquired the port after a crash.
    try {
      const health = await (
        await fetch(this.endpoint + "/api/health", this.authorized({ signal: AbortSignal.timeout(750) }))
      ).json();
      if (health.instance_id === this.instance) {
        await fetch(
          this.endpoint + "/api/system/shutdown",
          this.authorized({ method: "POST", signal: AbortSignal.timeout(1500) }),
        );
      }
    } catch {
      /* The child may already be exiting. */
    }
    for (let i = 0; i < 40 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") {
        await new Promise((resolve) => {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
          killer.once("close", resolve);
          killer.once("error", resolve);
        });
      } else {
        child.kill("SIGTERM");
        for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    }
  }
}

module.exports = {
  APP_ORIGIN,
  API_TOKEN_HEADER,
  Backend,
  apiTokenPath,
  configPath,
  mergeWslenv,
  configuredPort,
  selectPort,
  externalUrl,
  staticPath,
  contentPolicy,
};
