const fs = require("node:fs");
const path = require("node:path");
const { readEncryptedJson, secureStorageUnavailableReason, writeEncryptedJson } = require("./credentials.cjs");

// Seule instance autorisée : un jeton ne doit jamais partir vers un autre hôte.
const GITLAB_URL = "https://gitlab.sudokeys.com";
const TOKEN_FILE = "gitlab-token.bin";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_QUERY_LENGTH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function query(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > MAX_QUERY_LENGTH || /[\0\r\n]/.test(value)) {
    throw new Error("Recherche GitLab invalide.");
  }
  return value.trim();
}

function projectId(value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error("Dépôt GitLab invalide.");
  return value;
}

/** Date d'expiration donnée par GitLab (AAAA-MM-JJ), vide si le jeton n'en a pas. */
function expiryDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/** Jours restants : GitLab désactive le jeton à 0 h UTC le jour de son expiration. */
function daysUntil(expiresAt, now) {
  return Math.ceil((Date.parse(`${expiresAt}T00:00:00Z`) - now) / DAY_MS);
}

class GitLabClient {
  constructor({ directory, safeStorage, fetch, platform = process.platform, baseUrl = GITLAB_URL, now = Date.now }) {
    this.file = path.join(directory, TOKEN_FILE);
    this.safeStorage = safeStorage;
    this.fetch = fetch;
    this.platform = platform;
    this.baseUrl = baseUrl;
    this.now = now;
  }

  unavailableReason() {
    return secureStorageUnavailableReason(this.safeStorage, this.platform);
  }

  storedAccount() {
    if (this.unavailableReason()) return undefined;
    try {
      const payload = readEncryptedJson(this.file, this.safeStorage);
      if (payload && typeof payload.token === "string" && payload.token) return payload;
    } catch {
      // Jeton illisible (trousseau changé) : considéré comme déconnecté.
    }
    return undefined;
  }

  async request(pathname, params, token) {
    const url = new URL(`/api/v4${pathname}`, this.baseUrl);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== "" && value !== undefined) url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await this.fetch(url.href, {
        headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("GitLab est injoignable depuis cet ordinateur.");
    }
    if (response.status === 401) {
      this.markRejected(token);
      throw Object.assign(new Error("Jeton GitLab refusé ou expiré. Reconnecte GitLab dans les paramètres."), {
        status: 401,
      });
    }
    if (response.status === 403) throw new Error("Le jeton GitLab doit avoir la portée read_api.");
    if (!response.ok) throw new Error(`GitLab a répondu HTTP ${response.status}.`);
    return response.json();
  }

  /** Un jeton refusé par GitLab (expiré, révoqué) reste enregistré, marqué à remplacer. */
  markRejected(token) {
    const account = this.storedAccount();
    if (account?.token === token && !account.rejected) {
      writeEncryptedJson(this.file, this.safeStorage, { ...account, rejected: true });
    }
  }

  /** Refusé par GitLab ou arrivé à sa date : le jeton est expiré. */
  expiry(account) {
    const expiresAt = expiryDate(account?.expiresAt);
    const daysLeft = expiresAt ? daysUntil(expiresAt, this.now()) : null;
    const expired = Boolean(account) && (Boolean(account.rejected) || (daysLeft !== null && daysLeft <= 0));
    return { expiresAt, daysLeft, expired };
  }

  /** Date d'expiration du jeton ; vide si GitLab ne la donne pas (instance trop ancienne, jeton sans fin). */
  async tokenExpiry(token) {
    try {
      return expiryDate((await this.request("/personal_access_tokens/self", {}, token))?.expires_at);
    } catch {
      return "";
    }
  }

  status() {
    const reason = this.unavailableReason();
    const account = this.storedAccount();
    // Jeton présent mais indéchiffrable : sur macOS, un nouveau build signé ad hoc peut se voir
    // refuser la clé du trousseau. Le dire, au lieu de faire disparaître GitLab de l'interface.
    const unreadable = !reason && !account && fs.existsSync(this.file);
    // Un jeton expiré reste affiché comme tel : « Connecté » laissait croire que la recherche marchait.
    const { expiresAt, daysLeft, expired } = this.expiry(account);
    return {
      available: !reason,
      reason: unreadable
        ? "Le jeton GitLab enregistré ne peut plus être lu : le trousseau du système en refuse l'accès à cette version de l'application. Reconnecte ton compte."
        : reason,
      connected: Boolean(account) && !expired,
      unreadable,
      expired,
      expiresAt,
      daysLeft,
      username: account?.username || "",
      url: this.baseUrl,
    };
  }

  /**
   * Demande à GitLab si le jeton enregistré marche encore, et à quelle date il expire.
   * Un jeton enregistré avant que l'application ne lise sa date l'apprend ainsi. GitLab
   * injoignable : l'état enregistré est gardé tel quel.
   */
  async check() {
    const account = this.storedAccount();
    if (!account || account.rejected) return this.status();
    try {
      const token = await this.request("/personal_access_tokens/self", {}, account.token);
      writeEncryptedJson(this.file, this.safeStorage, { ...account, expiresAt: expiryDate(token?.expires_at) });
    } catch {
      // Refus déjà noté par request() ; autre échec : rien de sûr à enregistrer.
    }
    return this.status();
  }

  async connect(token) {
    const reason = this.unavailableReason();
    if (reason) throw new Error(reason);
    if (typeof token !== "string" || !/^[A-Za-z0-9_.-]{20,255}$/.test(token.trim())) {
      throw new Error("Jeton GitLab invalide.");
    }
    let user;
    try {
      user = await this.request("/user", {}, token.trim());
    } catch (error) {
      // Message lu dans l'assistant de connexion : y renvoyer « dans les paramètres » égarerait.
      if (error.status === 401) {
        throw new Error("GitLab refuse ce jeton : vérifie qu’il est copié en entier et qu’il n’a pas expiré.");
      }
      throw error;
    }
    const username = typeof user?.username === "string" ? user.username : "";
    const expiresAt = await this.tokenExpiry(token.trim());
    writeEncryptedJson(this.file, this.safeStorage, { token: token.trim(), username, expiresAt });
    return this.status();
  }

  disconnect() {
    fs.rmSync(this.file, { force: true });
    return this.status();
  }

  requireToken() {
    const account = this.storedAccount();
    if (!account) throw new Error("GitLab n’est pas connecté.");
    if (this.expiry(account).expired) throw new Error("Jeton GitLab expiré. Remplace-le dans les paramètres.");
    return account.token;
  }

  async searchProjects(search) {
    const token = this.requireToken();
    const projects = await this.request(
      "/projects",
      {
        search: query(search),
        membership: true,
        simple: true,
        archived: false,
        order_by: "last_activity_at",
        per_page: 20,
      },
      token,
    );
    return (Array.isArray(projects) ? projects : [])
      .map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path_with_namespace,
        sshUrl: project.ssh_url_to_repo,
        defaultBranch: project.default_branch || "",
        lastActivityAt: project.last_activity_at || "",
      }))
      .filter((project) => Number.isInteger(project.id) && typeof project.sshUrl === "string");
  }

  async listRefs(id, search) {
    const token = this.requireToken();
    const params = { search: query(search), per_page: 50 };
    const [branches, tags] = await Promise.all([
      this.request(`/projects/${projectId(id)}/repository/branches`, params, token),
      this.request(`/projects/${projectId(id)}/repository/tags`, { ...params, per_page: 20 }, token),
    ]);
    const names = (items) =>
      (Array.isArray(items) ? items : []).map((item) => item?.name).filter((name) => typeof name === "string");
    return {
      branches: (Array.isArray(branches) ? branches : [])
        .filter((branch) => typeof branch?.name === "string")
        .map((branch) => ({ name: branch.name, default: Boolean(branch.default) })),
      tags: names(tags),
    };
  }
}

module.exports = { GitLabClient, GITLAB_URL, TOKEN_FILE };
