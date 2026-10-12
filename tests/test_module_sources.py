import subprocess
import unittest
from pathlib import Path
from unittest import mock

import test_module_layout
from test_module_layout import DummyJob

import odoo_manager_web as web
from odoo_manager_core.repositories import RepositoryBranchMissing, repository_clone_error, repository_search_sources

EDI = "ssh://git@gitlab.sudokeys.com:10022/OCA/edi.git"
FRANCE = "ssh://git@gitlab.sudokeys.com:10022/OCA/l10n-france.git"
CLIENT = "ssh://git@gitlab.sudokeys.com:10022/sudokeys/client-addons.git"
COMMIT = "b" * 40


def source(url, *branches, in_project=False):
    label = web.git_checkouts.remote_label(url)
    return {"url": url, "label": label, "branches": list(branches or ["18.0"]), "in_project": in_project}


def module(name, version="18.0.1.0.0"):
    return {"name": name, "path": name, "manifest": {"version": version}, "has_symlink": False, "duplicate": False}


class RepositorySearchSourcesTests(unittest.TestCase):
    def test_branches_are_read_project_first_then_stable_then_those_of_other_projects(self):
        entries = [
            ("OTHER_15", "15.0", EDI, "15.0-fix"),
            ("OTHER_15B", "15.0", EDI, "15.0-fix"),
            ("OTHER_15C", "15.0", EDI, "15.0"),
            ("CLIENT_V18", "18.0", CLIENT, "master"),
            ("SECURIDOM", "15.0", FRANCE, "15.0-mig"),
            ("OTHER_15", "15.0", FRANCE, "15.0"),
        ]
        sources = repository_search_sources(entries, "SECURIDOM", "15.0")
        self.assertEqual(
            [
                ("gitlab.sudokeys.com/OCA/l10n-france", ["15.0-mig", "15.0"], True),
                ("gitlab.sudokeys.com/OCA/edi", ["15.0", "15.0-fix"], False),
                ("gitlab.sudokeys.com/sudokeys/client-addons", ["15.0"], False),
            ],
            [(item["label"], item["branches"], item["in_project"]) for item in sources],
        )

    def test_at_most_three_branches_are_read_per_repository(self):
        entries = [(f"P{index}", "18.0", EDI, f"18.0-work{index}") for index in range(5)]
        self.assertEqual(
            ["18.0", "18.0-work0", "18.0-work1"], repository_search_sources(entries, "OTHER", "18.0")[0]["branches"]
        )

    def test_same_repository_written_two_ways_is_read_once(self):
        entries = [
            ("A", "18.0", EDI, "18.0"),
            ("B", "18.0", "git@gitlab.sudokeys.com:OCA/edi.git", "18.0"),
            ("C", "18.0", "", "18.0"),
        ]
        self.assertEqual([source(EDI)], repository_search_sources(entries, "D", "18.0"))

    def test_without_any_branch_to_try_the_repository_is_skipped(self):
        self.assertEqual([], repository_search_sources([("A", "16.0", EDI, "16.0")], "B", ""))

    def test_missing_branch_has_its_own_error(self):
        error = repository_clone_error("warning: Remote branch 15.0 not found in upstream origin")
        self.assertIsInstance(error, RepositoryBranchMissing)
        self.assertNotIsInstance(repository_clone_error("Permission denied (publickey)."), RepositoryBranchMissing)


class ModuleSourcesJobTests(unittest.TestCase):
    # Le projet de test de ModuleLayoutTests, sans hériter de ses tests ni les relancer ici.
    def setUp(self):
        test_module_layout.ModuleLayoutTests.setUp(self)
        self.addCleanup(test_module_layout.ModuleLayoutTests.tearDown, self)
        patcher = mock.patch.object(web, "project_odoo_version", return_value="18.0")
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_search(self, sources, reads, names=("alpha", "beta", "gamma")):
        def read(project, url, branch, wanted):
            self.assertEqual(set(names), wanted)
            outcome = reads[url]
            if isinstance(outcome, Exception):
                raise outcome
            return COMMIT, outcome, True

        job = DummyJob()
        with (
            mock.patch.object(web, "module_search_sources", return_value=sources),
            mock.patch.object(web, "read_repository_modules", side_effect=read),
        ):
            web.module_sources_job(job, self.project, list(names))
        return job

    def test_search_reports_found_modules_missing_branches_and_unreadable_repositories(self):
        job = self.run_search(
            [source(EDI), source(CLIENT), source(FRANCE)],
            {
                EDI: [module("alpha"), module("gamma", "16.0.1.0.0")],
                CLIENT: RepositoryBranchMissing("absente"),
                FRANCE: RuntimeError("GitLab est inaccessible depuis cet ordinateur."),
            },
        )
        result = job.result
        self.assertEqual("module_sources", result["kind"])
        self.assertEqual(["alpha", "beta", "gamma"], result["searched"])
        self.assertEqual(3, result["scanned"])
        self.assertEqual(["gitlab.sudokeys.com/sudokeys/client-addons"], result["missing_branch"])
        self.assertEqual(
            [
                {
                    "label": "gitlab.sudokeys.com/OCA/l10n-france",
                    "branch": "18.0",
                    "error": "GitLab est inaccessible depuis cet ordinateur.",
                }
            ],
            result["failures"],
        )
        [repository] = result["repositories"]
        self.assertEqual((EDI, "18.0", COMMIT), (repository["url"], repository["branch"], repository["commit"]))
        plans = {plan["name"]: plan for plan in repository["modules"]}
        self.assertEqual("add", plans["alpha"]["action"])
        self.assertEqual("blocked", plans["gamma"]["action"])
        self.assertEqual(set(web.MODULE_SOURCE_PLAN_FIELDS), set(plans["alpha"]))
        self.assertIn("2 module(s) sur 3 trouvés dans 1 dépôt(s).", job.lines[-1])

    def test_same_refusal_everywhere_becomes_a_single_error(self):
        refusal = RuntimeError("GitLab refuse la clé SSH de cet ordinateur.")
        with self.assertRaisesRegex(RuntimeError, "clé SSH"):
            self.run_search([source(EDI), source(CLIENT)], {EDI: refusal, CLIENT: refusal})

    def test_search_without_known_repository_explains_what_to_do(self):
        with self.assertRaisesRegex(ValueError, "adresse de leur dépôt"):
            self.run_search([], {})

    def test_next_branch_is_read_only_for_modules_the_previous_ones_lack(self):
        calls = []

        def read(project, url, branch, wanted):
            calls.append((branch, sorted(wanted)))
            if branch == "18.0-gone":
                raise RepositoryBranchMissing("absente")
            found = {"18.0": ["alpha"], "18.0-work": ["beta"]}.get(branch, [])
            return COMMIT, [module(name) for name in found if name in wanted], True

        with mock.patch.object(web, "read_repository_modules", side_effect=read):
            reads = web.read_source_modules(
                self.project, source(EDI, "18.0-gone", "18.0", "18.0-work"), {"alpha", "beta", "gamma"}
            )
            self.assertEqual(
                [("18.0", ["alpha"]), ("18.0-work", ["beta"])],
                [(branch, [item["name"] for item in modules]) for branch, _commit, modules in reads],
            )
            self.assertEqual(
                [
                    ("18.0-gone", ["alpha", "beta", "gamma"]),
                    ("18.0", ["alpha", "beta", "gamma"]),
                    ("18.0-work", ["beta", "gamma"]),
                ],
                calls,
            )

            calls.clear()
            web.read_source_modules(self.project, source(EDI, "18.0", "18.0-work"), {"alpha"})
            self.assertEqual([("18.0", ["alpha"])], calls)

            with self.assertRaises(RepositoryBranchMissing):
                web.read_source_modules(self.project, source(EDI, "18.0-gone"), {"alpha"})

    def test_action_rejects_an_empty_list_and_reuses_a_running_search(self):
        with self.assertRaises(ValueError):
            web.module_sources_action({"project": self.project, "modules": ""})
        running = object()
        with mock.patch.object(web, "unfinished_job", return_value=running) as unfinished:
            self.assertIs(running, web.module_sources_action({"project": self.project, "modules": "alpha"}))
        unfinished.assert_called_once_with(web.module_sources_job, self.project)

    def test_read_downloads_only_the_manifests_of_wanted_modules(self):
        commands = []

        def fake_git(command, **kwargs):
            commands.append(command)
            if "clone" in command:
                Path(command[-1]).mkdir(parents=True)
                return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
            if "rev-parse" in command:
                return subprocess.CompletedProcess(command, 0, stdout=COMMIT, stderr="")
            if "ls-tree" in command:
                tree = "100644 blob a\talpha/__manifest__.py\n100644 blob b\tbeta/__manifest__.py"
                return subprocess.CompletedProcess(command, 0, stdout=tree, stderr="")
            checkout = Path(command[command.index("-C") + 1])
            self.assertEqual("/beta/__manifest__.py\n", (checkout / ".git/info/sparse-checkout").read_text())
            (checkout / "beta").mkdir()
            (checkout / "beta/__manifest__.py").write_text("{'version': '18.0.1.0.0'}")
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

        with mock.patch.object(web.subprocess, "run", side_effect=fake_git):
            commit, modules, manifests_read = web.read_repository_modules(self.project, EDI, "18.0", {"beta"})
            self.assertEqual((COMMIT, ["beta"], True), (commit, [item["name"] for item in modules], manifests_read))
            self.assertEqual("18.0.1.0.0", modules[0]["manifest"]["version"])

            commands.clear()
            self.assertEqual((COMMIT, [], False), web.read_repository_modules(self.project, EDI, "18.0", {"zzz"}))
        self.assertFalse(any("core.sparseCheckout=true" in command for command in commands))

    def test_workspace_entries_list_project_repositories_and_imports_but_not_enterprise(self):
        def git(*args, cwd):
            subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

        storage = self.project_root / "odoo/addons-store"
        for folder, url in (("edi", EDI), ("odoo_entreprise", CLIENT)):
            clone = storage / folder
            (clone / "alpha").mkdir(parents=True)
            (clone / "alpha/__manifest__.py").write_text("{'name': 'Alpha'}")
            git("init", "-q", "-b", "18.0", cwd=clone)
            git("remote", "add", "origin", url, cwd=clone)
        web.record_imported_sources(self.project, ["gamma"], FRANCE, "18.0-mig", COMMIT, {})

        self.assertEqual(
            [(self.project, "18.0", EDI, "18.0"), (self.project, "18.0", FRANCE, "18.0-mig")],
            web.workspace_repository_entries(),
        )


if __name__ == "__main__":
    unittest.main()
