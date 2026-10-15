const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GitLabClient, TOKEN_FILE } = require("../gitlab.cjs");

const TOKEN = "glpat-abcdefghijklmnopqrst";

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (value) => Buffer.from("enc:" + Buffer.from(value).toString("base64")),
    decryptString: (buffer) => Buffer.from(buffer.toString().slice(4), "base64").toString(),
  };
}

function fakeFetch(routes, calls) {
  return async (url, init) => {
    calls.push({ url: new URL(url), headers: init.headers, redirect: init.redirect });
    const route = routes[new URL(url).pathname];
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const [status, body] = typeof route === "function" ? route(new URL(url)) : route;
    return { ok: status < 400, status, json: async () => body };
  };
}

// 15 octobre 2026, 9 h 55 UTC : jour où le premier jeton de 30 jours a expiré (cas vécu).
const NOW = Date.parse("2026-10-15T09:55:00Z");

function client(t, routes, calls = [], now = () => NOW) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-gitlab-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    gitlab: new GitLabClient({
      directory,
      safeStorage: safeStorage(),
      fetch: fakeFetch(routes, calls),
      platform: "darwin",
      now,
    }),
  };
}

test("connects with a validated token stored encrypted, then disconnects", async (t) => {
  const calls = [];
  const { directory, gitlab } = client(
    t,
    {
      "/api/v4/user": [200, { username: "bperonne" }],
      "/api/v4/personal_access_tokens/self": [200, { expires_at: "2027-10-15" }],
    },
    calls,
  );

  const status = await gitlab.connect(`  ${TOKEN} `);

  assert.deepEqual(status, {
    available: true,
    reason: "",
    connected: true,
    unreadable: false,
    expired: false,
    expiresAt: "2027-10-15",
    daysLeft: 365,
    username: "bperonne",
    url: "https://gitlab.sudokeys.com",
  });
  assert.equal(calls[0].url.origin, "https://gitlab.sudokeys.com");
  assert.equal(calls[0].headers["PRIVATE-TOKEN"], TOKEN);
  assert.equal(calls[0].redirect, "error");
  assert.ok(!fs.readFileSync(path.join(directory, TOKEN_FILE), "utf8").includes(TOKEN));
  assert.equal(gitlab.disconnect().connected, false);
});

test("rejects malformed or refused tokens without storing them", async (t) => {
  const { directory, gitlab } = client(t, { "/api/v4/user": [401, {}] });
  await assert.rejects(gitlab.connect("short"), /Jeton GitLab invalide/);
  await assert.rejects(gitlab.connect(TOKEN), /GitLab refuse ce jeton/);
  assert.ok(!fs.existsSync(path.join(directory, TOKEN_FILE)));
});

test("searches member projects and lists branches and tags of the chosen one", async (t) => {
  const calls = [];
  const { gitlab } = client(
    t,
    {
      "/api/v4/user": [200, { username: "bperonne" }],
      "/api/v4/projects": [
        200,
        [
          {
            id: 42,
            name: "protex-addons",
            path_with_namespace: "sudokeys/protex-addons",
            ssh_url_to_repo: "ssh://git@gitlab.sudokeys.com:10022/sudokeys/protex-addons.git",
            default_branch: "DEV",
          },
          { id: "bad", name: "ignored" },
        ],
      ],
      "/api/v4/projects/42/repository/branches": [200, [{ name: "DEV", default: true }, { name: "17.0" }]],
      "/api/v4/projects/42/repository/tags": [200, [{ name: "v1.0" }]],
    },
    calls,
  );
  await gitlab.connect(TOKEN);

  const projects = await gitlab.searchProjects("protex");
  const refs = await gitlab.listRefs(42, "");

  assert.deepEqual(
    projects.map((project) => [project.id, project.sshUrl, project.defaultBranch]),
    [[42, "ssh://git@gitlab.sudokeys.com:10022/sudokeys/protex-addons.git", "DEV"]],
  );
  const search = calls.find((call) => call.url.pathname === "/api/v4/projects").url.searchParams;
  assert.equal(search.get("search"), "protex");
  assert.equal(search.get("membership"), "true");
  assert.deepEqual(refs, {
    branches: [
      { name: "DEV", default: true },
      { name: "17.0", default: false },
    ],
    tags: ["v1.0"],
  });
});

test("refuses API calls while disconnected and invalid identifiers", async (t) => {
  const { gitlab } = client(t, { "/api/v4/user": [200, { username: "bperonne" }] });
  await assert.rejects(gitlab.searchProjects("x"), /pas connecté/);
  await assert.rejects(gitlab.listRefs(1, ""), /pas connecté/);

  await gitlab.connect(TOKEN);
  await assert.rejects(gitlab.listRefs("42/../../user", ""), /Dépôt GitLab invalide/);
  await assert.rejects(gitlab.searchProjects("x".repeat(101)), /Recherche GitLab invalide/);
});

test("a stored token that can no longer be decrypted is reported, not silently dropped", async (t) => {
  // Cas vécu sur macOS : un nouveau build signé ad hoc se voit refuser la clé du trousseau. Le
  // jeton restait sur le disque, GitLab disparaissait de l'interface sans aucune explication.
  const { directory, gitlab } = client(t, { "/api/v4/user": [200, { username: "bperonne" }] });
  await gitlab.connect(TOKEN);
  gitlab.safeStorage = {
    ...safeStorage(),
    decryptString: () => {
      throw new Error("Keychain access denied");
    },
  };

  const status = gitlab.status();

  assert.equal(status.connected, false);
  assert.equal(status.unreadable, true);
  assert.equal(status.available, true);
  assert.match(status.reason, /Reconnecte ton compte/);
  assert.ok(fs.existsSync(path.join(directory, TOKEN_FILE)), "le fichier n’est jamais supprimé en silence");
});

test("an account never connected is simply disconnected, without alarming message", (t) => {
  const { gitlab } = client(t, {});
  const status = gitlab.status();
  assert.equal(status.connected, false);
  assert.equal(status.unreadable, false);
  assert.equal(status.reason, "");
});

test("a token GitLab no longer accepts is shown as expired, never as connected", async (t) => {
  // Cas vécu : jeton de 30 jours arrivé à échéance, paramètres toujours sur « Connecté ».
  let accepted = true;
  const { gitlab } = client(t, {
    "/api/v4/user": [200, { username: "bperonne" }],
    "/api/v4/projects": () => (accepted ? [200, []] : [401, { message: "401 Unauthorized" }]),
  });
  await gitlab.connect(TOKEN);
  accepted = false;

  await assert.rejects(gitlab.searchProjects("protex"), /refusé ou expiré/);

  const status = gitlab.status();
  assert.equal(status.connected, false);
  assert.equal(status.expired, true);
  assert.equal(status.username, "bperonne", "le compte reste affiché, à remplacer");
  // Plus aucun appel avec un jeton connu pour refusé : la raison est donnée tout de suite.
  await assert.rejects(gitlab.searchProjects("protex"), /Jeton GitLab expiré/);
});

test("the expiry date makes the token expired on that day, at midnight UTC, without asking GitLab", async (t) => {
  let now = Date.parse("2026-10-14T23:59:00Z");
  const { gitlab } = client(
    t,
    {
      "/api/v4/user": [200, { username: "bperonne" }],
      "/api/v4/personal_access_tokens/self": [200, { expires_at: "2026-10-15" }],
    },
    [],
    () => now,
  );
  await gitlab.connect(TOKEN);
  assert.equal(gitlab.status().daysLeft, 1);
  assert.equal(gitlab.status().connected, true);

  now = Date.parse("2026-10-15T00:00:00Z");

  assert.equal(gitlab.status().expired, true);
  assert.equal(gitlab.status().connected, false);
});

test("a token without expiry date, or an older GitLab, still connects", async (t) => {
  for (const route of [
    [200, { expires_at: null }],
    [404, {}],
  ]) {
    const { gitlab } = client(t, {
      "/api/v4/user": [200, { username: "bperonne" }],
      "/api/v4/personal_access_tokens/self": route,
    });
    const status = await gitlab.connect(TOKEN);
    assert.equal(status.connected, true);
    assert.equal(status.expiresAt, "");
    assert.equal(status.daysLeft, null);
  }
});

test("checking a token stored before expiry dates were read learns its date", async (t) => {
  let selfRoute = [404, {}];
  const { gitlab } = client(t, {
    "/api/v4/user": [200, { username: "bperonne" }],
    "/api/v4/personal_access_tokens/self": () => selfRoute,
  });
  await gitlab.connect(TOKEN);
  assert.equal(gitlab.status().expiresAt, "");

  selfRoute = [200, { expires_at: "2026-10-20" }];
  const status = await gitlab.check();

  assert.equal(status.expiresAt, "2026-10-20");
  assert.equal(status.daysLeft, 5);
  assert.equal(status.connected, true);
});

test("checking an expired token marks it, and an unreachable GitLab changes nothing", async (t) => {
  let selfRoute = [200, { expires_at: "2027-01-01" }];
  let reachable = true;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-gitlab-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const routes = {
    "/api/v4/user": [200, { username: "bperonne" }],
    "/api/v4/personal_access_tokens/self": () => selfRoute,
  };
  const fetch = fakeFetch(routes, []);
  const gitlab = new GitLabClient({
    directory,
    safeStorage: safeStorage(),
    fetch: async (url, init) => {
      if (!reachable) throw new Error("offline");
      return fetch(url, init);
    },
    platform: "darwin",
    now: () => NOW,
  });
  await gitlab.connect(TOKEN);

  reachable = false;
  assert.equal((await gitlab.check()).connected, true);

  reachable = true;
  selfRoute = [401, {}];
  const status = await gitlab.check();
  assert.equal(status.expired, true);
  assert.equal(status.connected, false);

  // Un nouveau jeton remplace l'ancien et efface le refus.
  selfRoute = [200, { expires_at: "2027-10-15" }];
  const replaced = await gitlab.connect("glpat-zyxwvutsrqponmlkjihg");
  assert.equal(replaced.connected, true);
  assert.equal(replaced.expired, false);
});
