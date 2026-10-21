const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  Backend,
  apiTokenPath,
  configPath,
  mergeWslenv,
  selectPort,
  externalUrl,
  staticPath,
  contentPolicy,
} = require("../runtime.cjs");

test("preserves configuration paths and explicit overrides", () => {
  assert.equal(
    configPath({}, "darwin", "/users/test"),
    path.join("/users/test", "Library/Application Support/Odoo Manager/config.json"),
  );
  assert.equal(
    configPath({ XDG_CONFIG_HOME: "/custom" }, "linux", "/users/test"),
    path.join("/custom", "odoo-manager/config.json"),
  );
  assert.equal(configPath({ ODOO_MANAGER_CONFIG_DIR: "/isolated" }), path.join("/isolated", "config.json"));
  assert.equal(configPath({ ODOO_MANAGER_CONFIG: "/specific.json" }), "/specific.json");
});

test("occupied port selects a different loopback port", async () => {
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  try {
    assert.notEqual(await selectPort(occupied.address().port), occupied.address().port);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("external navigation only accepts HTTP and HTTPS without embedded credentials", () => {
  assert.equal(externalUrl("http://dev.Caritel_v18.localhost/"), "http://dev.caritel_v18.localhost/");
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:secret@example.org",
  ]) {
    assert.throws(() => externalUrl(url));
  }
});

test("static routing rejects foreign origins and encoded traversal", () => {
  const root = path.resolve("out");
  assert.equal(staticPath("app://sdk/", root), path.join(root, "index.html"));
  for (const url of ["app://other/index.html", "app://sdk/%2e%2e%2fsecret", "app://sdk/%5csecret", "app://sdk/%00"]) {
    assert.throws(() => staticPath(url, root));
  }
});

test("CSP authorizes exact bootstrap scripts without unsafe script execution", () => {
  const policy = contentPolicy("<script>self.test=1;</script>", "http://127.0.0.1:19876");
  assert.match(policy, /script-src 'self' 'sha256-/);
  assert.doesNotMatch(
    policy.split(";").find((part) => part.includes("script-src")),
    /unsafe-inline|unsafe-eval/,
  );
  assert.match(policy, /connect-src 'self' http:\/\/127\.0\.0\.1:19876;/);
});

test("a backend command that fails falls back to the native executable", async (t) => {
  // Cas vécu sous Windows : la distribution WSL est installée mais ne démarre plus, et
  // l'application restait inutilisable alors que le backend natif était là, à côté.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-runtime-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fakeBackend = path.join(directory, "backend.cjs");
  fs.writeFileSync(
    fakeBackend,
    `
    const http = require('node:http');
    http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, instance_id: process.env.ODOO_MANAGER_INSTANCE_ID }));
    }).listen(Number(process.env.ODOO_GUI_PORT), '127.0.0.1');
  `,
  );

  const failures = [];
  const backend = new Backend({
    executable: process.execPath,
    args: [fakeBackend],
    logDir: directory,
    env: { ...process.env, ODOO_MANAGER_CONFIG_DIR: directory },
    // La commande dédiée échoue immédiatement, comme wsl.exe sans virtualisation.
    command: () => ({ executable: process.execPath, args: ["-e", "process.exit(1)"] }),
    onFallback: (error) => failures.push(error),
  });
  t.after(() => backend.stop?.());

  await backend.start();

  assert.equal(backend.ready, true, "le backend natif doit répondre après le repli");
  assert.equal(backend.command, null, "la commande défaillante ne doit pas être réessayée");
  assert.equal(failures.length, 1);
  assert.match(fs.readFileSync(path.join(directory, "backend.log"), "utf8"), /Backend opérationnel/);
});

test("the backend receives a per-launch token, requires it, and publishes it for local scripts", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-token-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fakeBackend = path.join(directory, "backend.cjs");
  // Refuse toute requête sans le jeton reçu dans son environnement, comme le vrai backend.
  fs.writeFileSync(
    fakeBackend,
    `
    const http = require('node:http');
    const token = process.env.ODOO_MANAGER_API_TOKEN;
    const server = http.createServer((request, response) => {
      if (!token || request.headers['x-sdk-manager-token'] !== token) {
        response.writeHead(401).end('{}');
        return;
      }
      if (request.url === '/api/system/shutdown') {
        response.writeHead(204).end();
        server.close(() => process.exit(0));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, instance_id: process.env.ODOO_MANAGER_INSTANCE_ID }));
    }).listen(Number(process.env.ODOO_GUI_PORT), '127.0.0.1');
  `,
  );
  const backend = new Backend({
    executable: process.execPath,
    args: [fakeBackend],
    logDir: directory,
    env: { ...process.env, ODOO_MANAGER_CONFIG_DIR: directory },
  });
  t.after(() => backend.stop());

  await backend.start();

  assert.equal(backend.ready, true);
  const tokenFile = apiTokenPath({ ODOO_MANAGER_CONFIG_DIR: directory });
  assert.equal(fs.readFileSync(tokenFile, "utf8"), backend.apiToken);
  if (process.platform !== "win32") assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
  assert.equal((await fetch(backend.endpoint + "/api/health")).status, 401);

  await backend.stop();

  assert.equal(fs.existsSync(tokenFile), false, "le jeton d'une session terminée ne doit pas rester sur disque");
  assert.notEqual(backend.child.exitCode, null, "l'arrêt authentifié doit être accepté par le backend");
});

test("the token variable is added once to WSLENV without dropping existing entries", () => {
  assert.equal(mergeWslenv("", "ODOO_MANAGER_API_TOKEN"), "ODOO_MANAGER_API_TOKEN");
  assert.equal(mergeWslenv("USERPROFILE/p", "ODOO_MANAGER_API_TOKEN"), "USERPROFILE/p:ODOO_MANAGER_API_TOKEN");
  assert.equal(mergeWslenv("ODOO_MANAGER_API_TOKEN:A", "ODOO_MANAGER_API_TOKEN"), "ODOO_MANAGER_API_TOKEN:A");
});

/** Faux backend à l'écoute sur `port`, qui n'accepte que `token` et s'arrête sur demande. */
async function leftoverBackend(port, token) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.headers["x-sdk-manager-token"] !== token) {
      response.writeHead(401).end("{}");
      return;
    }
    if (request.url === "/api/system/shutdown") {
      response.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
      server.close();
      server.closeAllConnections();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, pid: 4242, instance_id: "ancienne-session" }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { server, requests, port: server.address().port };
}

test("a backend left by a crashed session is stopped and its usual port reused", async (t) => {
  // Cas vécu : l'application avait été tuée, son backend gardait le port 18765 depuis des
  // heures, et chaque nouvelle session se rabattait sur un port au hasard.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-leftover-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, ODOO_MANAGER_CONFIG_DIR: directory };
  fs.writeFileSync(apiTokenPath(env), "jeton-de-la-session-precedente");
  const leftover = await leftoverBackend(0, "jeton-de-la-session-precedente");
  t.after(() => leftover.server.close());

  const backend = new Backend({ executable: "absent", logDir: directory, env, preferredPort: leftover.port });
  await backend.reserve();

  assert.equal(backend.port, leftover.port, "le port habituel doit être repris");
  assert.deepEqual(leftover.requests, ["/api/health", "/api/system/shutdown"]);
  assert.equal(leftover.server.listening, false);
  assert.match(fs.readFileSync(backend.logPath, "utf8"), /session précédente encore actif.*processus 4242/);
});

test("a program that does not accept this application's token keeps its port", async (t) => {
  // Le backend du script de développement a son propre jeton : il ne doit jamais être arrêté.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-foreign-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, ODOO_MANAGER_CONFIG_DIR: directory };
  fs.writeFileSync(apiTokenPath(env), "jeton-de-l-application");
  const other = await leftoverBackend(0, "jeton-du-script-de-developpement");
  t.after(() => other.server.close());

  const backend = new Backend({ executable: "absent", logDir: directory, env, preferredPort: other.port });
  await backend.reserve();

  assert.notEqual(backend.port, other.port);
  assert.deepEqual(other.requests, ["/api/health"], "aucun arrêt ne doit être demandé");
  assert.equal(other.server.listening, true);
});

test("without a token left on disk, an occupied port is not probed", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-notoken-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const other = await leftoverBackend(0, "inconnu");
  t.after(() => other.server.close());

  const backend = new Backend({
    executable: "absent",
    logDir: directory,
    env: { ...process.env, ODOO_MANAGER_CONFIG_DIR: directory },
    preferredPort: other.port,
  });
  await backend.reserve();

  assert.notEqual(backend.port, other.port);
  assert.deepEqual(other.requests, []);
});

test("the backend stops by itself when the application is killed", async (t) => {
  // Une application tuée n'exécute aucun arrêt : le backend doit le voir seul, par son
  // entrée standard que le système ferme, et connaître le processus de l'application.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-orphan-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fakeBackend = path.join(directory, "backend.cjs");
  const report = path.join(directory, "backend.json");
  fs.writeFileSync(
    fakeBackend,
    `
    const fs = require('node:fs');
    const http = require('node:http');
    fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({
      pid: process.pid,
      parentPid: process.env.ODOO_MANAGER_PARENT_PID,
      watchStdin: process.env.ODOO_MANAGER_WATCH_STDIN,
    }));
    process.stdin.resume();
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('error', () => process.exit(0));
    http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, instance_id: process.env.ODOO_MANAGER_INSTANCE_ID }));
    }).listen(Number(process.env.ODOO_GUI_PORT), '127.0.0.1');
  `,
  );
  // L'« application » : démarre le backend comme main.cjs, puis attend d'être tuée.
  const application = path.join(directory, "application.cjs");
  fs.writeFileSync(
    application,
    `
    const { Backend } = require(${JSON.stringify(path.resolve(__dirname, "../runtime.cjs"))});
    const backend = new Backend({
      executable: process.execPath,
      args: [${JSON.stringify(fakeBackend)}],
      logDir: ${JSON.stringify(directory)},
      env: { ...process.env, ODOO_MANAGER_CONFIG_DIR: ${JSON.stringify(directory)} },
    });
    backend.start().then(() => process.stdout.write('ready\\n'));
    setInterval(() => {}, 1000);
  `,
  );
  const app = spawn(process.execPath, [application], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => app.kill("SIGKILL"));
  await new Promise((resolve, reject) => {
    app.stdout.on("data", (chunk) => String(chunk).includes("ready") && resolve());
    app.once("exit", (code) => reject(new Error(`application arrêtée (code ${code})`)));
  });
  const { pid, parentPid, watchStdin } = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.equal(parentPid, String(app.pid));
  assert.equal(watchStdin, "1");

  app.kill("SIGKILL");

  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 50 && alive(); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (alive()) process.kill(pid, "SIGKILL");
  assert.equal(alive(), false, "le backend ne doit pas survivre à l'application");
});
