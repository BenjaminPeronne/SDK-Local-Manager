const { test } = require("node:test");
const assert = require("node:assert/strict");
const { allowScript, allowThroughFirewall, firewallStatus, firewallVerdict } = require("../windows-firewall.cjs");

const verdict = (category, rules) => firewallVerdict(JSON.stringify({ category, rules })).state;

test("a block for the current network wins over any allow, as in Windows", () => {
  // Question de Windows refusée : blocage TCP et UDP sur tous les profils.
  assert.equal(verdict("Private", [{ action: "Block", profile: "Any" }]), "blocked");
  // Autorisé seulement sur les réseaux privés, alors que le Wi-Fi est classé public.
  const privateOnly = [
    { action: "Allow", profile: "Private" },
    { action: "Block", profile: "Public" },
  ];
  assert.equal(verdict("Public", privateOnly), "blocked");
  assert.equal(verdict("Private", privateOnly), "allowed");
  assert.equal(verdict("DomainAuthenticated", [{ action: "Allow", profile: "Domain, Private" }]), "allowed");
  assert.equal(
    verdict("Private", [
      { action: "Allow", profile: "Any" },
      { action: "Block", profile: "Private, Public" },
    ]),
    "blocked",
  );
});

test("no rule or an unreadable answer is unknown, never blocked", () => {
  assert.equal(verdict("Private", []), "unknown");
  // ConvertTo-Json rend un seul élément sans tableau.
  assert.equal(
    firewallVerdict(JSON.stringify({ category: "Private", rules: { action: "Allow", profile: "Any" } })).state,
    "allowed",
  );
  assert.equal(firewallVerdict("pas du json").state, "unknown");
});

test("status passes the path and address through the environment", async () => {
  let env;
  const state = await firewallStatus("C:\\Apps\\SDK Local Manager.exe", "192.168.1.42", async (_command, received) => {
    env = received;
    return { code: 0, stdout: JSON.stringify({ category: "Private", rules: [] }) };
  });
  assert.deepEqual(state, { state: "unknown" });
  assert.deepEqual(env, { SDK_FIREWALL_EXE: "C:\\Apps\\SDK Local Manager.exe", SDK_FIREWALL_IP: "192.168.1.42" });
});

test("the allow script only opens the mobile access port for this application", () => {
  const script = allowScript("C:\\Users\\O'Neil\\SDK Local Manager.exe");
  assert.match(script, /'C:\\Users\\O''Neil\\SDK Local Manager\.exe'/);
  assert.match(script, /-Program \$exe -Protocol TCP -LocalPort 8069/);
  assert.match(script, /Where-Object \{ \$_.Action -eq 'Block' \} \| Remove-NetFirewallRule/);
});

test("a refused administrator confirmation is explained", async () => {
  await assert.rejects(
    allowThroughFirewall("C:\\a.exe", async () => ({ code: 1223 })),
    /Oui/,
  );
  await assert.rejects(
    allowThroughFirewall("C:\\a.exe", async () => ({ code: 5 })),
    /pare-feu/,
  );
  await allowThroughFirewall("C:\\a.exe", async (command) => {
    assert.match(command, /-Verb RunAs/);
    return { code: 0 };
  });
});
