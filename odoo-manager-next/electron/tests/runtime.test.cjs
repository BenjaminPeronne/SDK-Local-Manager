const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Backend, configPath, selectPort, externalUrl, staticPath, contentPolicy } = require('../runtime.cjs');

test('preserves configuration paths and explicit overrides', () => {
  assert.equal(configPath({}, 'darwin', '/users/test'), path.join('/users/test', 'Library/Application Support/Odoo Manager/config.json'));
  assert.equal(configPath({ XDG_CONFIG_HOME: '/custom' }, 'linux', '/users/test'), path.join('/custom', 'odoo-manager/config.json'));
  assert.equal(configPath({ ODOO_MANAGER_CONFIG_DIR: '/isolated' }), path.join('/isolated', 'config.json'));
  assert.equal(configPath({ ODOO_MANAGER_CONFIG: '/specific.json' }), '/specific.json');
});

test('occupied port selects a different loopback port', async () => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  try { assert.notEqual(await selectPort(occupied.address().port), occupied.address().port); }
  finally { await new Promise(resolve => occupied.close(resolve)); }
});

test('external navigation only accepts HTTP and HTTPS without embedded credentials', () => {
  assert.equal(externalUrl('http://dev.Caritel_v18.localhost/'), 'http://dev.caritel_v18.localhost/');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.org']) {
    assert.throws(() => externalUrl(url));
  }
});

test('static routing rejects foreign origins and encoded traversal', () => {
  const root = path.resolve('out');
  assert.equal(staticPath('app://sdk/', root), path.join(root, 'index.html'));
  for (const url of ['app://other/index.html', 'app://sdk/%2e%2e%2fsecret', 'app://sdk/%5csecret', 'app://sdk/%00']) {
    assert.throws(() => staticPath(url, root));
  }
});

test('CSP authorizes exact bootstrap scripts without unsafe script execution', () => {
  const policy = contentPolicy('<script>self.test=1;</script>', 'http://127.0.0.1:19876');
  assert.match(policy, /script-src 'self' 'sha256-/);
  assert.doesNotMatch(policy.split(';').find(part => part.includes('script-src')), /unsafe-inline|unsafe-eval/);
  assert.match(policy, /connect-src 'self' http:\/\/127\.0\.0\.1:19876;/);
});

test('a backend command that fails falls back to the native executable', async t => {
  // Cas vécu sous Windows : la distribution WSL est installée mais ne démarre plus, et
  // l'application restait inutilisable alors que le backend natif était là, à côté.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fakeBackend = path.join(directory, 'backend.cjs');
  fs.writeFileSync(fakeBackend, `
    const http = require('node:http');
    http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, instance_id: process.env.ODOO_MANAGER_INSTANCE_ID }));
    }).listen(Number(process.env.ODOO_GUI_PORT), '127.0.0.1');
  `);

  const failures = [];
  const backend = new Backend({
    executable: process.execPath,
    args: [fakeBackend],
    logDir: directory,
    env: { ...process.env, ODOO_MANAGER_CONFIG_DIR: directory },
    // La commande dédiée échoue immédiatement, comme wsl.exe sans virtualisation.
    command: () => ({ executable: process.execPath, args: ['-e', 'process.exit(1)'] }),
    onFallback: error => failures.push(error),
  });
  t.after(() => backend.stop?.());

  await backend.start();

  assert.equal(backend.ready, true, 'le backend natif doit répondre après le repli');
  assert.equal(backend.command, null, 'la commande défaillante ne doit pas être réessayée');
  assert.equal(failures.length, 1);
  assert.match(fs.readFileSync(path.join(directory, 'backend.log'), 'utf8'), /Backend opérationnel/);
});
