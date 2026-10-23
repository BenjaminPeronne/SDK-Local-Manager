import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Le proxy relaie les requêtes sans y ajouter le jeton de l'API : tout ce qui joint ce port,
// un module Odoo dans un conteneur par host.docker.internal par exemple, l'aurait obtenu avec.
// La page l'envoie elle-même, depuis le lien ouvert par odoo_next_gui.sh (lib/browser-token.ts).
const backend = process.env.ODOO_MANAGER_API || "http://127.0.0.1:18765";
const configDir = dirname(fileURLToPath(import.meta.url));
const desktopBuild = process.env.ELECTRON_BUILD === "1";

function git(...args: string[]) {
  try {
    return execFileSync("git", args, { cwd: configDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// Numéro de build figé dans l'interface : tag app-v<version>-build<N> du build (CI, script
// build_all_platforms.sh) ou tag posé sur le commit courant, et commit court pour le support.
function buildIdentity() {
  const tag =
    process.env.ODOO_MANAGER_BUILD_TAG ||
    (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "") ||
    process.env.CI_COMMIT_TAG ||
    git("describe", "--tags", "--exact-match", "--match", "app-v*");
  const build = /^app-v\d+\.\d+\.\d+-build(\d+)$/.exec(tag || "")?.[1] ?? "";
  const commit = (process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || git("rev-parse", "HEAD")).slice(0, 7);
  return { NEXT_PUBLIC_APP_BUILD: build, NEXT_PUBLIC_APP_COMMIT: commit };
}

const env = buildIdentity();

const browserConfig: NextConfig = {
  agentRules: false,
  // Next.js 16 ne fait fonctionner l'interface de développement qu'à l'adresse de son lancement :
  // ouverte par 127.0.0.1 alors que `npm run dev` sert localhost (ou l'inverse), la page restait
  // figée sur son premier affichage.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env,
  outputFileTracingRoot: configDir,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

const nextConfig: NextConfig = desktopBuild
  ? { agentRules: false, env, output: "export", outputFileTracingRoot: configDir }
  : browserConfig;

export default nextConfig;
