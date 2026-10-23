/**
 * Jeton de l'API pour l'interface ouverte dans un navigateur (odoo_next_gui.sh).
 *
 * Le proxy de `next dev` ne l'ajoute pas : tout ce qui joint son port, un module Odoo dans un
 * conteneur par host.docker.internal par exemple, l'obtiendrait avec. Le script ouvre l'interface
 * avec le jeton dans le fragment (#sdk_token=…), que le navigateur n'envoie jamais au serveur ;
 * la page le garde pour sa seule adresse et le retire de la barre d'adresse.
 * L'application de bureau n'en a pas : Electron ajoute lui-même le jeton à chaque requête.
 */
export const API_TOKEN_HEADER = "X-SDK-Manager-Token";
export const API_TOKEN_PARAMETER = "sdk_token";
export const API_TOKEN_STORAGE_KEY = "sdk-manager-api-token";

type TokenStorage = Pick<Storage, "getItem" | "setItem">;

export type TokenPage = {
  location: Pick<Location, "hash" | "pathname" | "search">;
  storage: TokenStorage | null;
  replaceUrl: (url: string) => void;
};

export function tokenFromFragment(hash: string) {
  return new URLSearchParams(hash.replace(/^#/, "")).get(API_TOKEN_PARAMETER)?.trim() || "";
}

export function readApiToken({ location, storage, replaceUrl }: TokenPage) {
  const fresh = tokenFromFragment(location.hash);
  if (!fresh) {
    try {
      return storage?.getItem(API_TOKEN_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }
  try {
    if (storage) {
      storage.setItem(API_TOKEN_STORAGE_KEY, fresh);
      replaceUrl(location.pathname + location.search);
    }
  } catch {
    // Stockage refusé (navigation privée stricte) : le jeton reste dans l'adresse, seule copie.
  }
  return fresh;
}

function browserPage(): TokenPage | null {
  if (typeof window === "undefined") return null;
  let storage: TokenStorage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    location: window.location,
    storage,
    replaceUrl: (url) => window.history.replaceState(window.history.state, "", url),
  };
}

export function browserApiToken(page: TokenPage | null = browserPage()) {
  return page ? readApiToken(page) : "";
}

export function apiTokenHeaders(token = browserApiToken()): Record<string, string> {
  return token ? { [API_TOKEN_HEADER]: token } : {};
}

/** Adresse d'un flux (EventSource) : il ne sait pas envoyer d'en-tête, le jeton passe dans l'adresse. */
export function withApiToken(url: string, token = browserApiToken()) {
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${API_TOKEN_PARAMETER}=${encodeURIComponent(token)}`;
}

/** Lien qui ouvre l'interface à une autre adresse (route Traefik) avec le jeton de cette page. */
export function interfaceLinkWithToken(origin: string, token = browserApiToken()) {
  return token ? `${origin}/#${API_TOKEN_PARAMETER}=${encodeURIComponent(token)}` : `${origin}/`;
}
