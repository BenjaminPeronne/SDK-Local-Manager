import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_TOKEN_STORAGE_KEY,
  apiTokenHeaders,
  interfaceLinkWithToken,
  readApiToken,
  tokenFromFragment,
  withApiToken,
} from "./browser-token.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test("the token opened by odoo_next_gui.sh is kept for the page and removed from the address bar", () => {
  const storage = memoryStorage();
  const replaced: string[] = [];
  const location = { hash: "#sdk_token=abc-123_x", pathname: "/", search: "?tab=modules" };

  assert.equal(readApiToken({ location, storage, replaceUrl: (url) => replaced.push(url) }), "abc-123_x");
  assert.equal(storage.values.get(API_TOKEN_STORAGE_KEY), "abc-123_x");
  assert.deepEqual(replaced, ["/?tab=modules"]);

  const later = { hash: "", pathname: "/", search: "" };
  assert.equal(
    readApiToken({ location: later, storage, replaceUrl: () => assert.fail("rien à retirer") }),
    "abc-123_x",
  );
});

test("a page opened without the link has no token, and a refused storage leaves it in the address", () => {
  const empty = { hash: "", pathname: "/", search: "" };
  // Appelé dans un try : un assert.fail y serait avalé, on relève donc les appels.
  const replaced: string[] = [];
  const keep = (url: string) => void replaced.push(url);
  assert.equal(readApiToken({ location: empty, storage: memoryStorage(), replaceUrl: keep }), "");
  assert.equal(tokenFromFragment("#section"), "");

  const refused = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  const opened = { hash: "#sdk_token=only-in-the-address", pathname: "/", search: "" };
  assert.equal(readApiToken({ location: opened, storage: refused, replaceUrl: keep }), "only-in-the-address");
  assert.equal(readApiToken({ location: opened, storage: null, replaceUrl: keep }), "only-in-the-address");
  assert.equal(readApiToken({ location: empty, storage: refused, replaceUrl: keep }), "");
  assert.deepEqual(replaced, [], "l'adresse garde la seule copie du jeton");
});

test("requests carry the token in a header, streams and links in the address", () => {
  assert.deepEqual(apiTokenHeaders(""), {});
  assert.deepEqual(apiTokenHeaders("t"), { "X-SDK-Manager-Token": "t" });
  assert.equal(withApiToken("/api/stream", ""), "/api/stream");
  assert.equal(withApiToken("/api/stream", "a+b"), "/api/stream?sdk_token=a%2Bb");
  assert.equal(withApiToken("/api/projects/p/logs/stream?raw=1", "t"), "/api/projects/p/logs/stream?raw=1&sdk_token=t");
  assert.equal(interfaceLinkWithToken("http://rika.localhost", "t"), "http://rika.localhost/#sdk_token=t");
  assert.equal(interfaceLinkWithToken("http://rika.localhost", ""), "http://rika.localhost/");
});
