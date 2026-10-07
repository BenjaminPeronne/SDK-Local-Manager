import { test } from "node:test";
import assert from "node:assert/strict";
import { groupModulesByRepository, NO_REPOSITORY_GROUP, repositoryRevision } from "./module-repositories.ts";
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
