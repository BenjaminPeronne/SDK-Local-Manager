import { test } from "node:test";
import assert from "node:assert/strict";
import { gitlabTokenDate, gitlabTokenNotice } from "./gitlab-token.ts";
import type { GitLabStatus } from "./desktop.ts";

function status(overrides: Partial<GitLabStatus>): GitLabStatus {
  return {
    available: true,
    reason: "",
    connected: true,
    expired: false,
    expiresAt: "2026-10-22",
    daysLeft: 7,
    username: "bperonne",
    url: "https://gitlab.sudokeys.com",
    ...overrides,
  };
}

test("dates come from GitLab as UTC days, whatever the computer's time zone", () => {
  assert.equal(gitlabTokenDate("2026-10-15"), "15 octobre 2026");
  assert.equal(gitlabTokenDate("2027-01-01"), "1 janvier 2027");
});

test("a token expiring within the week is announced, not before", () => {
  assert.deepEqual(gitlabTokenNotice(status({})), {
    expired: false,
    text: "Ton jeton GitLab expire dans 7 jours, le 22 octobre 2026.",
  });
  assert.equal(
    gitlabTokenNotice(status({ daysLeft: 1, expiresAt: "2026-10-16" }))?.text,
    "Ton jeton GitLab expire demain, le 16 octobre 2026.",
  );
  assert.equal(gitlabTokenNotice(status({ daysLeft: 8, expiresAt: "2026-10-23" })), null);
  assert.equal(gitlabTokenNotice(status({ daysLeft: null, expiresAt: "" })), null);
});

test("an expired token says when it expired, or that GitLab refused it", () => {
  assert.deepEqual(
    gitlabTokenNotice(status({ connected: false, expired: true, daysLeft: 0, expiresAt: "2026-10-15" })),
    {
      expired: true,
      text: "Ton jeton GitLab a expiré le 15 octobre 2026.",
    },
  );
  assert.equal(
    gitlabTokenNotice(status({ connected: false, expired: true, daysLeft: null, expiresAt: "" }))?.text,
    "Ton jeton GitLab a expiré ou a été révoqué.",
  );
});

test("no account, no message", () => {
  assert.equal(gitlabTokenNotice(null), null);
  assert.equal(gitlabTokenNotice(status({ connected: false, expiresAt: "", daysLeft: null })), null);
});
