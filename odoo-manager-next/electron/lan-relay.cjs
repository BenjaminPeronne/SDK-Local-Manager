const dgram = require("node:dgram");
const net = require("node:net");

// Accès mobile sous WSL : Docker publie Odoo sur l'adresse de la VM (172.x), que le téléphone ne
// voit pas. Windows relaie son adresse Wi-Fi vers celle-ci ; au premier lancement, Windows demande
// d'autoriser l'application sur le réseau privé.
const PORT = 8069;
const PRIVATE_IPV4 = /^(10|127|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(\.\d{1,3})?$/;

/** Adresse de la VM visée, refusée si ce n'est pas une adresse privée sur le port de l'accès mobile. */
function relayTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Adresse de l'accès mobile illisible.");
  }
  if (parsed.protocol !== "http:" || Number(parsed.port) !== PORT || !PRIVATE_IPV4.test(parsed.hostname))
    throw new Error("Adresse de l'accès mobile refusée.");
  return parsed.hostname;
}

/** Adresse de Windows sur le Wi-Fi : même choix d'interface que iot_box.local_ip() côté Linux. */
function windowsLanIp() {
  return new Promise((resolve) => {
    const probe = dgram.createSocket("udp4");
    probe.once("error", () => {
      probe.close();
      resolve("");
    });
    // UDP : rien n'est envoyé, le système choisit juste l'interface.
    probe.connect(9, "192.0.2.1", () => {
      const { address } = probe.address();
      probe.close();
      resolve(address);
    });
  });
}

class LanRelay {
  constructor({ lanIp = windowsLanIp, listenPort = PORT } = {}) {
    this.lanIp = lanIp;
    this.listenPort = listenPort;
    this.server = null;
    this.key = "";
    // Adresse Wi-Fi du relais ouvert : le pare-feu est lu pour ce réseau-là.
    this.ip = "";
    this.sockets = new Set();
  }

  /** Ouvre (ou garde) le relais vers `url` et rend l'adresse à donner au téléphone. */
  async start(url) {
    const target = relayTarget(url);
    const ip = await this.lanIp();
    if (!ip) throw new Error("Ce poste n'est relié à aucun réseau : connecte-le au Wi-Fi, puis réessaie.");
    const key = `${ip}>${target}`;
    if (this.server && this.key === key) return `http://${ip}:${this.listenPort}/`;
    await this.stop();
    const server = net.createServer((client) => {
      const upstream = net.connect(PORT, target);
      this.sockets.add(client).add(upstream);
      const close = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on("error", close).on("close", close);
      upstream.on("error", close).on("close", close);
      client.pipe(upstream).pipe(client);
    });
    await new Promise((resolve, reject) => {
      server.once("error", (error) =>
        reject(
          error.code === "EADDRINUSE"
            ? new Error(`Le port ${this.listenPort} est déjà utilisé sur ce poste : ferme le programme qui l'occupe.`)
            : error,
        ),
      );
      server.listen(this.listenPort, ip, resolve);
    });
    this.server = server;
    this.key = key;
    this.ip = ip;
    return `http://${ip}:${this.listenPort}/`;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.key = "";
    this.ip = "";
    if (!server) return;
    // close() attend la fin des connexions gardées ouvertes par le navigateur du téléphone.
    const closed = new Promise((resolve) => server.close(() => resolve()));
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await closed;
  }
}

module.exports = { LanRelay, relayTarget, windowsLanIp };
