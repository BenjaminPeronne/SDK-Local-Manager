import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterBranches,
  formatCommitDate,
  groupModulesByRepository,
  matchWantedModules,
  NO_REPOSITORY_GROUP,
  repositoryBranchLocked,
  repositoryRevisionManageable,
  REPOSITORY_CHECK_TTL_MS,
  repositoriesToCheck,
  repositoryCheckKey,
  type RepositoryCheckEntry,
  repositoryCommitUrl,
  repositoryCompareUrl,
  repositoryRevision,
  repositoryUpdatable,
  repositoryUpdateAvailable,
  type RepositoryUpdateCheck,
  repositoryWebUrl,
  sharedReplacedRepository,
} from "./module-repositories.ts";
import type { ModuleInfo, ModuleRepository, RepositoryModule } from "./types.ts";

function repository(id: string, values: Partial<ModuleRepository> = {}): ModuleRepository {
  return {
    id,
    name: id,
    path: `/store/${id}`,
    standard: false,
    source: "git",
    branch: "",
    tag: "",
    commit: "",
    remote: "",
    remote_label: "",
    ...values,
  };
}

function module(name: string, repositoryId = "", state = "uninstalled"): ModuleInfo {
  return { name, title: name, state, path: `/addons/${name}`, repository: repositoryId };
}

test("modules are grouped by repository, project repositories before standard Odoo", () => {
  const repositories = [
    repository("sodial-addons", { branch: "dev" }),
    repository("pos", { branch: "19.0-mig" }),
    repository("odoo", { standard: true, source: "odoo", branch: "19.0" }),
  ];
  const modules = [
    module("sale", "odoo", "installed"),
    module("sodial_sale", "sodial-addons", "installed"),
    module("lonely_copy"),
    module("sodial_base", "sodial-addons", "to upgrade"),
    module("ghost", "removed-repository"),
  ];

  const groups = groupModulesByRepository(modules, repositories);

  assert.deepEqual(
    groups.map((group) => [group.id, group.modules.map((item) => item.name), group.installed]),
    [
      ["sodial-addons", ["sodial_sale", "sodial_base"], 2],
      [NO_REPOSITORY_GROUP, ["lonely_copy", "ghost"], 0],
      ["odoo", ["sale"], 1],
    ],
  );
  assert.equal(groups[1].repository, null);
});

test("the loaded revision is the branch, then the tag, then the short commit", () => {
  assert.deepEqual(repositoryRevision(repository("a", { branch: "dev", tag: "v1" })), { kind: "branch", label: "dev" });
  assert.deepEqual(repositoryRevision(repository("a", { tag: "19.0.1.0.2" })), { kind: "tag", label: "19.0.1.0.2" });
  assert.deepEqual(repositoryRevision(repository("a", { commit: "4ca6a5538a96243" })), {
    kind: "commit",
    label: "4ca6a55",
  });
  assert.equal(repositoryRevision(repository("a")), null);
});

test("commit pages follow the GitLab or GitHub address of the repository", () => {
  const gitlab = { remote_label: "gitlab.sudokeys.com/OCA/pos" };
  assert.equal(repositoryWebUrl(gitlab), "https://gitlab.sudokeys.com/OCA/pos");
  assert.equal(repositoryCommitUrl(gitlab, "abc123"), "https://gitlab.sudokeys.com/OCA/pos/-/commit/abc123");
  assert.equal(
    repositoryCompareUrl(gitlab, "abc123", "def456"),
    "https://gitlab.sudokeys.com/OCA/pos/-/compare/abc123...def456",
  );
  const github = { remote_label: "github.com/OCA/pos" };
  assert.equal(repositoryCommitUrl(github, "abc123"), "https://github.com/OCA/pos/commit/abc123");
  assert.equal(repositoryCompareUrl(github, "abc123", "def456"), "https://github.com/OCA/pos/compare/abc123...def456");
  // Sans adresse connue, ou sans commit, pas de lien.
  assert.equal(repositoryCommitUrl({ remote_label: "" }, "abc123"), "");
  assert.equal(repositoryCommitUrl(gitlab, ""), "");
  assert.equal(repositoryCompareUrl(gitlab, "", "def456"), "");
});

test("only a branch behind the server, or with an unknown commit, can be updated", () => {
  const branch = { current: "18.0", remote_commit: "b".repeat(40) };
  assert.equal(repositoryUpdatable({ ...branch, commit_status: "behind" }), true);
  assert.equal(repositoryUpdatable({ ...branch, commit_status: "unknown" }), true);
  assert.equal(repositoryUpdatable({ ...branch, commit_status: "same" }), false);
  assert.equal(repositoryUpdatable({ ...branch, commit_status: "ahead" }), false);
  assert.equal(repositoryUpdatable({ ...branch, commit_status: "missing", remote_commit: "" }), false);
  // Dépôt sur une étiquette : pas de branche à mettre à jour.
  assert.equal(repositoryUpdatable({ ...branch, current: "", commit_status: "unknown" }), false);
});

test("the commit date is written in full, empty when unreadable", () => {
  assert.match(formatCommitDate("2026-10-12T14:05:00+02:00"), /octobre 2026 à \d{2}:\d{2}$/);
  assert.equal(formatCommitDate(""), "");
  assert.equal(formatCommitDate("pas une date"), "");
});

test("the replaced repository is shown once when every replacing copy shares it", () => {
  const copy = (name: string, replaced = "") => ({ ...module(name, "import"), replaced_repository: replaced });
  assert.deepEqual(
    sharedReplacedRepository([copy("a", "gazdom-addons (master)"), copy("b", "gazdom-addons (master)"), copy("c")]),
    { label: "gazdom-addons (master)", count: 2 },
  );
  assert.equal(sharedReplacedRepository([copy("a", "x (master)"), copy("b", "y (18.0)")]), null);
  assert.equal(sharedReplacedRepository([copy("a")]), null);
});

test("project repositories, imported copies, Odoo and Enterprise are updated from the list; Odoo keeps its branch", () => {
  assert.equal(repositoryRevisionManageable(repository("addons")), true);
  assert.equal(repositoryRevisionManageable(repository("archive", { source: "sdk" })), true);
  assert.equal(repositoryRevisionManageable(repository("import:x#dev", { source: "import", path: "" })), true);
  assert.equal(repositoryRevisionManageable(repository("odoo", { source: "odoo", standard: true, path: "" })), false);
  assert.equal(repositoryRevisionManageable(repository("enterprise", { standard: true })), true);
  assert.equal(repositoryBranchLocked(repository("enterprise", { standard: true })), true);
  assert.equal(repositoryBranchLocked(repository("addons")), false);
  assert.equal(repositoryRevisionManageable(repository("unknown", { path: "" })), false);
});

test("branch search ignores case and keeps the server order", () => {
  const branches = [
    { name: "master", default: true },
    { name: "TI20914-fix", default: false },
    { name: "ti20915", default: false },
  ];
  assert.deepEqual(
    filterBranches(branches, " ti209 ").map((branch) => branch.name),
    ["TI20914-fix", "ti20915"],
  );
  assert.equal(filterBranches(branches, "").length, 3);
});

function repositoryModule(name: string, action: RepositoryModule["action"], path = name): RepositoryModule {
  return {
    name,
    path,
    title: name,
    version: "",
    current_version: "",
    installed_version: "",
    state: "",
    action,
    reason: "",
    warning: "",
  };
}

test("matchWantedModules sépare les modules manquants importables, bloqués et absents du dépôt", () => {
  const modules = [
    repositoryModule("account_payment_mode", "add"),
    repositoryModule("account_payment_partner", "update"),
    repositoryModule("account_banking_pain_base", "blocked"),
    repositoryModule("unrelated", "add"),
  ];
  assert.deepEqual(
    matchWantedModules(modules, [
      "account_payment_mode",
      "account_banking_pain_base",
      "account_payment_partner",
      "account_invoice_facturx",
      "account_payment_mode",
    ]),
    {
      importable: ["account_payment_mode", "account_payment_partner"],
      blocked: ["account_banking_pain_base"],
      absent: ["account_invoice_facturx"],
    },
  );
});

test("matchWantedModules retient un nom présent deux fois dès qu'une copie est importable", () => {
  const modules = [repositoryModule("base_rest", "blocked", "old/base_rest"), repositoryModule("base_rest", "add")];
  assert.deepEqual(matchWantedModules(modules, ["base_rest"]), { importable: ["base_rest"], blocked: [], absent: [] });
  assert.deepEqual(matchWantedModules([], []), { importable: [], blocked: [], absent: [] });
});

test("only branch repositories without a recent check are compared with the server", () => {
  const now = 1_000_000_000;
  const clone = repository("/store/clone", { branch: "18.0", commit: "a".repeat(40) });
  const fresh = repository("/store/fresh", { branch: "18.0", commit: "b".repeat(40) });
  const stale = repository("/store/stale", { branch: "18.0", commit: "c".repeat(40) });
  const tagged = repository("/store/tagged", { tag: "v1", commit: "d".repeat(40) });
  const odoo = repository("odoo", { branch: "18.0", standard: true, source: "odoo" });
  const entries = new Map<string, RepositoryCheckEntry>([
    [repositoryCheckKey("demo", fresh), { at: now - 1000, check: null }],
    [repositoryCheckKey("demo", stale), { at: now - REPOSITORY_CHECK_TTL_MS, check: null }],
    // Contrôle d'un autre projet ou d'un autre commit chargé : ne compte pas.
    [repositoryCheckKey("other", clone), { at: now, check: null }],
  ]);

  assert.deepEqual(
    repositoriesToCheck("demo", [clone, fresh, stale, tagged, odoo], entries, now).map((item) => item.id),
    ["/store/clone", "/store/stale"],
  );
  // Nouveau commit chargé après une mise à jour : un nouveau contrôle.
  assert.deepEqual(
    repositoriesToCheck("demo", [{ ...fresh, commit: "e".repeat(40) }], entries, now).map((item) => item.id),
    ["/store/fresh"],
  );
});

test("an update is announced only when the server has a newer commit on the branch", () => {
  const check = (values: Partial<RepositoryUpdateCheck>): RepositoryUpdateCheck => ({
    branch: "18.0",
    commit: "a".repeat(40),
    remote_commit: "b".repeat(40),
    commit_status: "behind",
    ...values,
  });
  assert.equal(repositoryUpdateAvailable(check({})), true);
  assert.equal(repositoryUpdateAvailable(check({ commit_status: "same" })), false);
  assert.equal(repositoryUpdateAvailable(check({ commit_status: "ahead" })), false);
  assert.equal(repositoryUpdateAvailable(check({ commit_status: "unknown" })), false);
  assert.equal(repositoryUpdateAvailable(check({ remote_commit: "" })), false);
  assert.equal(repositoryUpdateAvailable(null), false);
});
