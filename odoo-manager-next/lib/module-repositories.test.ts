import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterBranches,
  groupModulesByRepository,
  NO_REPOSITORY_GROUP,
  repositoryBranchSwitchable,
  repositoryRevision,
  sharedReplacedRepository,
} from "./module-repositories.ts";
import type { ModuleInfo, ModuleRepository } from "./types.ts";

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

test("the replaced repository is shown once when every replacing copy shares it", () => {
  const copy = (name: string, replaced = "") => ({ ...module(name, "import"), replaced_repository: replaced });
  assert.deepEqual(
    sharedReplacedRepository([copy("a", "gazdom-addons (master)"), copy("b", "gazdom-addons (master)"), copy("c")]),
    { label: "gazdom-addons (master)", count: 2 },
  );
  assert.equal(sharedReplacedRepository([copy("a", "x (master)"), copy("b", "y (18.0)")]), null);
  assert.equal(sharedReplacedRepository([copy("a")]), null);
});

test("only project repositories and imported copies can switch branch", () => {
  assert.equal(repositoryBranchSwitchable(repository("addons")), true);
  assert.equal(repositoryBranchSwitchable(repository("archive", { source: "sdk" })), true);
  assert.equal(repositoryBranchSwitchable(repository("import:x#dev", { source: "import", path: "" })), true);
  assert.equal(repositoryBranchSwitchable(repository("odoo", { source: "odoo", standard: true })), false);
  assert.equal(repositoryBranchSwitchable(repository("enterprise", { standard: true })), false);
  assert.equal(repositoryBranchSwitchable(repository("unknown", { path: "" })), false);
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
