import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latestModuleSourcesJob,
  moduleSourcesResult,
  planModuleSources,
  shortRepositoryLabel,
} from "./module-sources.ts";
import type { Job, ModuleSourcePlan, ModuleSourceRepository, ModuleSourcesResult } from "./types.ts";

function plan(name: string, action: ModuleSourcePlan["action"] = "add", reason = ""): ModuleSourcePlan {
  return { name, path: name, title: name, version: "15.0.1.0.0", action, reason, warning: "" };
}

function repository(label: string, modules: ModuleSourcePlan[], in_project = false): ModuleSourceRepository {
  return { url: `ssh://${label}.git`, label, branch: "15.0", in_project, commit: "c".repeat(40), modules };
}

function result(searched: string[], repositories: ModuleSourceRepository[]): ModuleSourcesResult {
  return { kind: "module_sources", searched, odoo_version: "15.0", repositories };
}

function job(id: number, project: string, value: Job["result"]): Job {
  return { id, title: "", project, status: "done", started_at: "", lines: [], result: value };
}

test("planModuleSources groupe les modules dans le moins de dépôts possible", () => {
  const edi = repository("gitlab/OCA/edi", [plan("facturx"), plan("einvoice")]);
  const fork = repository("gitlab/sudokeys/edi-fork", [plan("facturx")]);
  const payment = repository("gitlab/OCA/bank-payment", [plan("payment_mode"), plan("facturx")]);
  const sources = planModuleSources(result(["facturx", "einvoice", "payment_mode"], [payment, edi, fork]), [
    "payment_mode",
    "facturx",
    "einvoice",
  ]);
  assert.deepEqual(
    sources.groups.map((group) => [group.repository.label, group.modules.map((module) => module.name)]),
    [
      ["gitlab/OCA/bank-payment", ["facturx", "payment_mode"]],
      ["gitlab/OCA/edi", ["einvoice"]],
    ],
  );
  assert.equal(sources.found, 3);
});

test("planModuleSources préfère un dépôt du projet à égalité", () => {
  const other = repository("gitlab/a/addons", [plan("alpha")]);
  const mine = repository("gitlab/z/addons", [plan("alpha")], true);
  const sources = planModuleSources(result(["alpha"], [other, mine]), ["alpha"]);
  assert.deepEqual(
    sources.groups.map((group) => group.repository.label),
    ["gitlab/z/addons"],
  );
});

test("planModuleSources sépare non importables, introuvables et modules non cherchés", () => {
  const old = repository("gitlab/OCA/old", [plan("legacy", "blocked", "Module prévu pour Odoo 14.0"), plan("alpha")]);
  const sources = planModuleSources(result(["legacy", "alpha", "ghost"], [old]), ["ghost", "alpha", "legacy", "new"]);
  assert.deepEqual(
    sources.groups.map((group) => group.modules.map((module) => module.name)),
    [["alpha"]],
  );
  assert.deepEqual(
    sources.blocked.map((item) => [item.name, item.repository.label, item.reason]),
    [["legacy", "gitlab/OCA/old", "Module prévu pour Odoo 14.0"]],
  );
  assert.deepEqual(sources.absent, ["ghost"]);
  assert.deepEqual(sources.unsearched, ["new"]);
});

test("planModuleSources ne propose que les modules encore manquants", () => {
  const edi = repository("gitlab/OCA/edi", [plan("facturx"), plan("einvoice")]);
  const sources = planModuleSources(result(["facturx", "einvoice"], [edi]), ["einvoice"]);
  assert.deepEqual(
    sources.groups.map((group) => group.modules.map((module) => module.name)),
    [["einvoice"]],
  );
  assert.deepEqual(planModuleSources(result([], []), []).groups, []);
});

test("latestModuleSourcesJob retient la dernière recherche du projet", () => {
  const search = { kind: "module_sources", searched: ["alpha"], odoo_version: "15.0" };
  const jobs = [
    job(4, "A", { kind: "repository_modules", modules: ["alpha"] }),
    job(2, "A", search),
    job(3, "A", search),
    job(5, "B", search),
  ];
  assert.equal(latestModuleSourcesJob(jobs, "A")?.id, 3);
  assert.equal(latestModuleSourcesJob(jobs, "C"), null);
  assert.equal(moduleSourcesResult(jobs[0]), null);
  assert.equal(moduleSourcesResult({ result: { kind: "module_sources" } }), null);
});

test("shortRepositoryLabel retire le serveur de l'adresse", () => {
  assert.equal(shortRepositoryLabel("gitlab.sudokeys.com/OCA/edi"), "OCA/edi");
  assert.equal(shortRepositoryLabel("edi"), "edi");
});
