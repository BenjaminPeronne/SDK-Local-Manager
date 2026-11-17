const { execFile } = require("node:child_process");
const { elevatedCommand } = require("./wsl.cjs");

// Pare-feu de Windows pour le relais de l'accès mobile (lan-relay.cjs). Si l'utilisateur ferme la
// question « Autoriser l'accès ? » de Windows, celui-ci bloque l'application sans plus jamais
// demander : le téléphone attend alors sans fin.
const RULE_NAME = "SDK Local Manager - accès mobile";
const PORT = 8069;
const EXIT_ELEVATION_REFUSED = 1223;

// Règles entrantes actives qui visent l'exécutable de l'application (chemins écrits avec %VAR% compris).
const APP_RULES =
  "Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and " +
  "[Environment]::ExpandEnvironmentVariables($_.Program) -ieq $exe } | Get-NetFirewallRule | " +
  "Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' }";

// Chemin et adresse passent par l'environnement : aucun guillemet à échapper.
const STATUS_SCRIPT = [
  "$exe = [IO.Path]::GetFullPath($env:SDK_FIREWALL_EXE)",
  "$address = Get-NetIPAddress -IPAddress $env:SDK_FIREWALL_IP -ErrorAction SilentlyContinue | Select-Object -First 1",
  "$category = if ($address) { (Get-NetConnectionProfile -InterfaceIndex $address.InterfaceIndex -ErrorAction SilentlyContinue).NetworkCategory }",
  `$rules = @(${APP_RULES} | ForEach-Object { [pscustomobject]@{ action = $_.Action.ToString(); profile = $_.Profile.ToString() } })`,
  '[pscustomobject]@{ category = "$category"; rules = $rules } | ConvertTo-Json -Compress -Depth 3',
].join("\n");

const powershellLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Script élevé : retire les blocages de l'application, puis l'autorise sur le seul port de l'accès mobile. */
function allowScript(exe) {
  return [
    `$exe = [IO.Path]::GetFullPath(${powershellLiteral(exe)})`,
    `${APP_RULES} | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule`,
    `Get-NetFirewallRule -DisplayName ${powershellLiteral(RULE_NAME)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
    // Tous les profils : un Wi-Fi de maison est souvent classé « public » par Windows.
    `New-NetFirewallRule -DisplayName ${powershellLiteral(RULE_NAME)} -Direction Inbound -Action Allow ` +
      `-Program $exe -Protocol TCP -LocalPort ${PORT} -Profile Any | Out-Null`,
  ].join("\n");
}

/**
 * `allowed`, `blocked` (un blocage vise ce réseau ; il l'emporte sur toute autorisation, comme dans
 * Windows) ou `unknown` (aucune règle : Windows pose sa question, ou l'a posée sans réponse).
 */
function firewallVerdict(output) {
  let data;
  try {
    data = JSON.parse(output);
  } catch {
    return { state: "unknown" };
  }
  const profile = data?.category === "DomainAuthenticated" ? "Domain" : String(data?.category || "");
  const rules = (Array.isArray(data?.rules) ? data.rules : data?.rules ? [data.rules] : []).filter(
    (rule) => !profile || rule.profile === "Any" || String(rule.profile).split(", ").includes(profile),
  );
  const state = rules.some((rule) => rule.action === "Block")
    ? "blocked"
    : rules.some((rule) => rule.action === "Allow")
      ? "allowed"
      : "unknown";
  return { state };
}

function powershell(command, env) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, timeout: 120000, env: { ...process.env, ...env } },
      (error, stdout) => resolve({ code: !error ? 0 : typeof error.code === "number" ? error.code : 1, stdout }),
    );
  });
}

async function firewallStatus(exe, ip, run = powershell) {
  const { code, stdout } = await run(STATUS_SCRIPT, { SDK_FIREWALL_EXE: exe, SDK_FIREWALL_IP: ip });
  return code === 0 ? firewallVerdict(stdout) : { state: "unknown" };
}

/** Une seule demande d'autorisation administrateur de Windows. */
async function allowThroughFirewall(exe, run = powershell) {
  const { code } = await run(elevatedCommand(allowScript(exe)));
  if (code === EXIT_ELEVATION_REFUSED)
    throw new Error("Windows n'a pas donné l'autorisation : clique sur « Oui » quand il la demande.");
  if (code !== 0) throw new Error("Le pare-feu de Windows n'a pas pu être réglé.");
}

module.exports = { allowScript, allowThroughFirewall, firewallStatus, firewallVerdict };
