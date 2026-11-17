const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { LanRelay, relayTarget } = require("../lan-relay.cjs");

test("only relays to a private address on the mobile access port", () => {
  assert.equal(relayTarget("http://172.31.140.75:8069/"), "172.31.140.75");
  assert.throws(() => relayTarget("http://172.31.140.75:22/"));
  assert.throws(() => relayTarget("http://8.8.8.8:8069/"));
  assert.throws(() => relayTarget("http://example.com:8069/"));
  assert.throws(() => relayTarget("pas une adresse"));
});

test("forwards the phone to the address inside WSL and closes cleanly", async (t) => {
  // Odoo simulé sur 127.0.0.1:8069 ; le relais écoute sur un autre port, à la place du Wi-Fi de Windows.
  const odoo = http.createServer((_request, response) => response.end("odoo"));
  try {
    await new Promise((resolve, reject) => odoo.once("error", reject).listen(8069, "127.0.0.1", resolve));
  } catch {
    t.skip("le port 8069 est déjà pris sur ce poste");
    return;
  }
  t.after(() => odoo.close());
  const relay = new LanRelay({ lanIp: async () => "127.0.0.1", listenPort: 18069 });
  t.after(() => relay.stop());

  const address = await relay.start("http://127.0.0.1:8069/");
  assert.equal(address, "http://127.0.0.1:18069/");
  assert.equal(await relay.start("http://127.0.0.1:8069/"), address);
  const body = await new Promise((resolve, reject) =>
    http
      .get(address + "web", { agent: new http.Agent({ keepAlive: true }) }, (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk)).on("end", () => resolve(text));
      })
      .on("error", reject),
  );
  assert.equal(body, "odoo");

  await relay.stop();
  await assert.rejects(
    new Promise((resolve, reject) => http.get(address, resolve).on("error", reject)),
    /ECONNREFUSED/,
  );
});
