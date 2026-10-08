import json
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from test_module_layout import DummyJob, ModuleLayoutTests

import odoo_manager_web as web

URL = "ssh://git@gitlab.sudokeys.com:10022/team/addons.git"
COMMIT = "a" * 40


class RepositoryModulesTests(ModuleLayoutTests):
    manifests = {
        "alpha": "{'name': 'Alpha', 'version': '18.0.1.0.1'}",
        "beta": "{'name': 'Beta', 'version': '18.0.1.0.0'}",
    }

    def setUp(self):
        super().setUp()
        # Les faux subprocess.run ne simulent que git : sur un runner Windows avec wsl.exe,
        # les sondes WSL leur parvenaient et créaient des dossiers `sh` ou `git` à la racine.
        for patcher in (
            mock.patch.object(web, "project_odoo_version", return_value="18.0"),
            mock.patch.object(web, "addon_links_wsl_distribution", return_value=None),
            mock.patch("odoo_manager_core.project_creator.platform_id", return_value="linux"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def clone(self, command, **kwargs):
        if "rev-parse" in command:
            return subprocess.CompletedProcess(command, 0, stdout=COMMIT + "\n", stderr="")
        root = Path(command[-1])
        root.mkdir(parents=True)
        for name, manifest in self.manifests.items():
            (root / name).mkdir()
            (root / name / "__manifest__.py").write_text(manifest)
            (root / name / "code.py").write_text("new")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    def run_import(self, names, commit=""):
        job = DummyJob()
        with mock.patch.object(web.subprocess, "run", side_effect=self.clone):
            web.repository_modules_job(job, self.project, URL, "18.0", names, commit)
        return job

    def storage(self, name=""):
        return self.project_root / "odoo/addons-store" / name

    def test_repository_validation(self):
        invalid_urls = (
            "http://example.com/a",
            "https://gitlab.sudokeys.com/team/repository.git",
            "file:///tmp/a",
            "ssh://git@gitlab.sudokeys.com/team/repository.git",
            "ssh://token@gitlab.sudokeys.com:10022/team/repository.git",
            "ssh://git@gitlab.example:10022/team/repository.git",
        )
        for url in invalid_urls:
            with self.assertRaises(ValueError):
                web.validate_module_repository(url, "18.0", "alpha")
        self.assertEqual(web.validate_module_repository(URL, "18.0", "alpha")[0], URL)
        self.assertEqual(
            web.validate_module_repository("git@gitlab.sudokeys.com:team/repository.git", "18.0", "alpha")[0],
            "git@gitlab.sudokeys.com:team/repository.git",
        )
        self.assertEqual(
            web.validate_module_repository(URL, "18.0", "beta,alpha", COMMIT)[2:], (["alpha", "beta"], COMMIT)
        )
        with self.assertRaisesRegex(ValueError, "au moins un module"):
            web.validate_module_repository(URL, "18.0", "")
        with self.assertRaisesRegex(ValueError, "Commit"):
            web.validate_module_repository(URL, "18.0", "alpha", "HEAD; rm -rf /")

    def test_repository_clone_uses_non_interactive_ssh_without_credentials(self):
        def ssh_clone(command, **kwargs):
            rendered_command = " ".join(command)
            self.assertIn("core.sshCommand=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new", command)
            self.assertIn("protocol.ssh.allow=always", command)
            self.assertNotIn("credential.helper", rendered_command)
            return self.clone(command, **kwargs)

        with mock.patch.object(web.subprocess, "run", side_effect=ssh_clone):
            web.repository_modules_job(DummyJob(), self.project, URL, "18.0", ["alpha"])

    def test_new_module_is_copied_and_linked(self):
        job = self.run_import(["alpha"])
        self.assertEqual(
            job.result,
            {"kind": "repository_modules", "modules": ["alpha"], "added": ["alpha"], "updated": [], "replaced": []},
        )
        self.assertTrue((self.project_root / "odoo/addons/alpha").is_symlink())
        self.assertFalse((self.project_root / "odoo/addons/beta").exists())

    def test_mixed_selection_adds_new_modules_and_updates_managed_ones(self):
        # Recette : 3 modules dont 2 déjà présents faisaient échouer tout l'import.
        self.run_import(["alpha"])
        (self.storage("alpha") / "code.py").write_text("old")

        job = self.run_import(["beta", "alpha"])

        self.assertEqual((job.result["added"], job.result["updated"]), (["beta"], ["alpha"]))
        self.assertEqual((self.storage("alpha") / "code.py").read_text(), "new")
        self.assertTrue((self.project_root / "odoo/addons/beta").is_symlink())
        self.assertTrue(list((self.root / ".odoo_manager_backups/modules" / self.project).glob("*/code.py")))

    def test_failed_import_restores_updates_and_removes_only_what_it_created(self):
        self.run_import(["alpha"])
        (self.storage("alpha") / "code.py").write_text("old")
        original = web.copy_module_to_storage

        def fail_beta(job, project, candidate, **kwargs):
            if candidate.name == "beta":
                raise OSError("disk full")
            return original(job, project, candidate, **kwargs)

        with mock.patch.object(web, "copy_module_to_storage", side_effect=fail_beta):
            with self.assertRaises(OSError):
                self.run_import(["alpha", "beta"])
        self.assertEqual((self.storage("alpha") / "code.py").read_text(), "old")
        self.assertTrue((self.project_root / "odoo/addons/alpha").is_symlink())
        self.assertFalse(self.storage("beta").exists())
        self.assertFalse((self.project_root / "odoo/addons/beta").is_symlink())

    def test_missing_selection_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "absents du dépôt"):
            self.run_import(["missing"])

    def test_empty_selection_is_rejected_without_cloning(self):
        with mock.patch.object(web.subprocess, "run", side_effect=AssertionError("clone")):
            with self.assertRaisesRegex(ValueError, "au moins un module"):
                web.repository_modules_job(DummyJob(), self.project, URL, "18.0", [])

    def test_repository_clone_failure_leaves_project_unchanged(self):
        with mock.patch.object(web.subprocess, "run", return_value=subprocess.CompletedProcess([], 128)):
            with self.assertRaises(RuntimeError):
                web.repository_modules_job(DummyJob(), self.project, URL, "18.0", ["alpha"])
        self.assertEqual(list(self.storage().iterdir()), [])

    def test_repository_clone_reports_missing_credentials(self):
        failure = subprocess.CompletedProcess([], 128, stderr="git@gitlab.sudokeys.com: Permission denied (publickey).")
        with mock.patch.object(web.subprocess, "run", return_value=failure):
            with self.assertRaisesRegex(RuntimeError, "clé SSH"):
                web.repository_modules_job(DummyJob(), self.project, URL, "18.0", ["alpha"])

    def test_symlink_blocks_only_the_module_that_contains_it(self):
        def clone_link(command, **kwargs):
            result = self.clone(command, **kwargs)
            if "clone" in command:
                (Path(command[-1]) / "beta/external").symlink_to(self.external)
            return result

        with mock.patch.object(web.subprocess, "run", side_effect=clone_link):
            with self.assertRaisesRegex(ValueError, "beta : Contient des liens symboliques"):
                web.repository_modules_job(DummyJob(), self.project, URL, "18.0", ["beta"])
            self.assertEqual(list(self.storage().iterdir()), [])
            web.repository_modules_job(DummyJob(), self.project, URL, "18.0", ["alpha"])
        self.assertTrue(self.storage("alpha").is_dir())

    def test_changed_branch_since_inspection_is_refused(self):
        with self.assertRaisesRegex(ValueError, "nouveaux commits"):
            self.run_import(["alpha"], commit="b" * 40)
        self.assertEqual(list(self.storage().iterdir()), [])
        self.assertEqual(self.run_import(["alpha"], commit=COMMIT).result["added"], ["alpha"])

    def test_module_for_another_odoo_series_is_blocked(self):
        self.manifests = {**self.manifests, "alpha": "{'name': 'Alpha', 'version': '17.0.1.0.0'}"}
        with self.assertRaisesRegex(ValueError, "Prévu pour Odoo 17.0"):
            self.run_import(["alpha", "beta"])
        self.assertEqual(list(self.storage().iterdir()), [])

    def test_repository_add_refuses_to_shadow_a_module_already_provided_by_the_project(self):
        core = self.project_root / "odoo/odoo/addons/beta"
        core.mkdir(parents=True)
        (core / "__manifest__.py").write_text("{'name': 'Core'}")
        web.clear_project_module_cache(self.project)

        with self.assertRaisesRegex(ValueError, "avant toute modification[\\s\\S]*beta : Fourni par Odoo standard"):
            self.run_import(["alpha", "beta"])
        self.assertFalse((self.project_root / "odoo/addons/beta").exists())
        self.assertFalse(self.storage("alpha").exists())

    def test_module_from_another_repository_is_replaced_then_restored(self):
        # Cas CARITEL et GAZDOM : projet créé depuis le dépôt de production du client, rangé sous
        # addons-store ; ses modules ne pouvaient plus être importés depuis leur propre dépôt.
        other = self.storage("caritel_v18/addons/alpha")
        other.mkdir(parents=True)
        (other / "__manifest__.py").write_text("{'name': 'Alpha', 'version': '18.0.1.0.0'}")
        link = self.project_root / "odoo/addons/alpha"
        original_link = "../addons-store/caritel_v18/addons/alpha"
        link.symlink_to(original_link)

        job = self.run_import(["alpha"])

        self.assertEqual(["alpha"], job.result["replaced"])
        self.assertEqual(Path("../addons-store/alpha"), Path(link.readlink()))
        self.assertEqual("{'name': 'Alpha', 'version': '18.0.1.0.0'}", (other / "__manifest__.py").read_text())
        self.assertEqual(original_link, web.read_imported_sources(self.project)["alpha"]["replaced_link"])
        modules = web.modules_for(self.project)
        web.module_repositories(self.project, modules)
        alpha = next(module for module in modules if module["name"] == "alpha")
        self.assertEqual("addons-store/caritel_v18/addons", alpha["replaced_repository"])

        # Réimporter le module garde le lien d'origine à rétablir.
        self.run_import(["alpha"])
        self.assertEqual(original_link, web.read_imported_sources(self.project)["alpha"]["replaced_link"])

        restore = DummyJob()
        web.restore_module_source_job(restore, self.project, "alpha")

        # Valeur du lien et non resolve() : sur le runner Windows, resolve() du lien garde le nom
        # court du dossier temporaire (RUNNER~1) alors que celui du dossier cible est développé.
        self.assertEqual(Path(original_link), Path(link.readlink()))
        self.assertFalse(self.storage("alpha").exists())
        self.assertNotIn("alpha", web.read_imported_sources(self.project))
        with self.assertRaisesRegex(RuntimeError, "rien à rétablir"):
            web.restore_module_source_job(DummyJob(), self.project, "alpha")

    def test_whole_repository_is_restored_at_once_after_checking_every_module(self):
        links = {}
        for name in ("alpha", "beta"):
            other = self.storage(f"caritel_v18/addons/{name}")
            other.mkdir(parents=True)
            (other / "__manifest__.py").write_text(f"{{'name': '{name}', 'version': '18.0.1.0.0'}}")
            links[name] = f"../addons-store/caritel_v18/addons/{name}"
            (self.project_root / "odoo/addons" / name).symlink_to(links[name])
        self.run_import(["alpha", "beta"])

        # Un module sans version de dépôt à rétablir : refus avant toute modification.
        with self.assertRaisesRegex(RuntimeError, "ghost ne remplace"):
            web.restore_module_source_job(DummyJob(), self.project, "alpha,ghost")
        self.assertEqual(Path("../addons-store/alpha"), Path((self.project_root / "odoo/addons/alpha").readlink()))

        job = DummyJob()
        web.restore_module_source_job(job, self.project, "beta,alpha")

        for name in ("alpha", "beta"):
            self.assertEqual(Path(links[name]), Path((self.project_root / "odoo/addons" / name).readlink()))
            self.assertFalse(self.storage(name).exists())
        self.assertEqual(["alpha", "beta"], job.result["modules"])
        self.assertEqual({}, web.read_imported_sources(self.project))
        action = web.restore_module_source_action({"project": self.project, "modules": "beta,alpha"})
        self.assertEqual("Revenir à la version du dépôt · 2 modules", action.title)

    def test_enterprise_module_of_another_repository_stays_blocked(self):
        enterprise = self.storage("caritel_v18/addons-store/odoo_entreprise/alpha")
        enterprise.mkdir(parents=True)
        (enterprise / "__manifest__.py").write_text("{'name': 'Alpha'}")
        (self.project_root / "odoo/addons/alpha").symlink_to(
            "../addons-store/caritel_v18/addons-store/odoo_entreprise/alpha"
        )

        with self.assertRaisesRegex(ValueError, "alpha : Fourni par Odoo standard ou Enterprise"):
            self.run_import(["alpha"])

    def test_tree_listing_follows_import_discovery_rules(self):
        tree = "\n".join(
            [
                "100644 blob a\tsale_x/__manifest__.py",
                "100644 blob b\tsale_x/tests/fixture/__manifest__.py",
                "100644 blob c\taddons/stock_y/__openerp__.py",
                "100644 blob d\tnode_modules/pkg/__manifest__.py",
                "120000 blob e\tstock_y_link",
                "100644 blob f\tREADME.md",
            ]
        )
        modules, symlinks = web.repository_tree_modules(tree, "client-addons")
        self.assertEqual(
            {("sale_x", "sale_x", "__manifest__.py"), ("addons/stock_y", "stock_y", "__openerp__.py")},
            set(modules),
        )
        self.assertEqual(["stock_y_link"], symlinks)

        single, _ = web.repository_tree_modules(
            "100644 blob a\t__manifest__.py\n100644 blob b\tsub/__manifest__.py", "my_module"
        )
        self.assertEqual([("", "my_module", "__manifest__.py")], single)

    def test_inspection_reads_only_manifests_and_plans_each_module(self):
        self.run_import(["alpha"])
        (self.storage("alpha") / "__manifest__.py").write_text("{'name': 'Alpha', 'version': '18.0.1.0.0'}")
        commands = []

        def fake_git(command, **kwargs):
            commands.append(command)
            if "clone" in command:
                Path(command[-1]).mkdir(parents=True)
                return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
            if "rev-parse" in command:
                return subprocess.CompletedProcess(command, 0, stdout=COMMIT, stderr="")
            if "ls-tree" in command:
                tree = "\n".join(
                    [
                        "100644 blob a\talpha/__manifest__.py",
                        "100644 blob b\tbeta/__manifest__.py",
                        "100644 blob c\tbad name/__manifest__.py",
                        "100644 blob d\told/__manifest__.py",
                    ]
                )
                return subprocess.CompletedProcess(command, 0, stdout=tree, stderr="")
            self.assertIn("core.sparseCheckout=true", command)
            checkout = Path(command[command.index("-C") + 1])
            for manifest, content in zip(
                (line.lstrip("/") for line in (checkout / ".git/info/sparse-checkout").read_text().splitlines()),
                ("{'version': '18.0.1.0.1'}", "{'name': 'Beta'}", "{}", "{'version': '16.0.1.0.0'}"),
                strict=True,
            ):
                (checkout / manifest).parent.mkdir(parents=True, exist_ok=True)
                (checkout / manifest).write_text(content)
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

        with (
            mock.patch.object(web.subprocess, "run", side_effect=fake_git),
            mock.patch.object(web, "module_dirs", side_effect=AssertionError("scan du projet")),
        ):
            result = web.inspect_repository_modules(self.project, URL, "DEV")

        clone = next(command for command in commands if "clone" in command)
        self.assertIn("--filter=blob:none", clone)
        self.assertIn("--no-checkout", clone)
        self.assertEqual(COMMIT, result["commit"])
        self.assertTrue(result["manifests_read"])
        by_name = {module["name"]: module for module in result["modules"]}
        self.assertEqual(
            ("update", "18.0.1.0.0", "18.0.1.0.1"),
            (by_name["alpha"]["action"], by_name["alpha"]["current_version"], by_name["alpha"]["version"]),
        )
        self.assertEqual("add", by_name["beta"]["action"])
        self.assertEqual("blocked", by_name["bad name"]["action"])
        self.assertIn("Odoo 16.0", by_name["old"]["reason"])
        # L'import qui a préparé alpha a noté son dépôt dans le dossier technique .odoo_manager_imports.
        self.assertEqual(
            [path for path in self.storage().iterdir() if not path.name.startswith(".")], [self.storage("alpha")]
        )

    def test_sparse_checkout_pattern_matches_only_the_exact_manifest(self):
        self.assertEqual("/addons/x\\*y/__manifest__.py\n", web.sparse_checkout_pattern("addons/x*y/__manifest__.py"))
        self.assertEqual("/#odd/__manifest__.py\n", web.sparse_checkout_pattern("#odd/__manifest__.py"))

    def test_downgrade_is_allowed_with_a_warning(self):
        self.run_import(["alpha"])
        (self.storage("alpha") / "__manifest__.py").write_text("{'name': 'Alpha', 'version': '18.0.2.0.0'}")
        plans = web.repository_module_plans(
            self.project, [{"name": "alpha", "path": "alpha", "manifest": {"version": "18.0.1.0.1"}}], {}, "18.0"
        )
        self.assertEqual("update", plans[0]["action"])
        self.assertIn("plus ancienne", plans[0]["warning"])

    def test_inspection_rejects_untrusted_repository_url(self):
        with self.assertRaises(ValueError):
            web.inspect_repository_modules(self.project, "https://example.org/repo.git", "main")

    def test_repository_import_never_scans_the_whole_project(self):
        # Sous Windows, module_dirs() lance wsl.exe : un import ne doit jamais en dépendre.
        with mock.patch.object(web, "module_dirs", side_effect=AssertionError("scan du projet")):
            job = self.run_import(["alpha"])
        self.assertEqual(job.result["modules"], ["alpha"])

    def test_remote_branches_put_the_default_first_and_ignore_ssh_noise(self):
        output = "\n".join(
            (
                "Warning: Permanently added 'gitlab.sudokeys.com' to the list of known hosts.",
                "ref: refs/heads/master\tHEAD",
                f"{COMMIT}\tHEAD",
                f"{COMMIT}\trefs/heads/ti20914",
                f"{COMMIT}\trefs/heads/Feature/x",
                f"{COMMIT}\trefs/heads/10.0",
                f"{COMMIT}\trefs/heads/8.0",
                f"{COMMIT}\trefs/heads/master",
            )
        )
        self.assertEqual(
            [
                {"name": "master", "default": True},
                {"name": "8.0", "default": False},
                {"name": "10.0", "default": False},
                {"name": "Feature/x", "default": False},
                {"name": "ti20914", "default": False},
            ],
            web.remote_branches(output),
        )

    def test_only_repositories_of_addons_store_can_switch_branch(self):
        (self.project_root / "odoo/odoo/.git").mkdir()
        enterprise = self.storage("odoo_entreprise")
        (enterprise / ".git").mkdir(parents=True)
        for repository in (self.project_root / "odoo/odoo", enterprise, Path("relative"), self.root / "elsewhere"):
            with self.assertRaises(ValueError):
                web.switchable_repository(self.project, str(repository))
        with self.assertRaisesRegex(ValueError, "Aucun module importé"):
            web.switchable_repository(self.project, f"import:{URL}#18.0")

    def test_imported_copies_are_reimported_from_the_new_branch(self):
        self.run_import(["alpha", "beta"])
        (self.storage("alpha") / "code.py").write_text("old")
        branches = []

        def clone(command, **kwargs):
            if "clone" in command:
                branches.append(command[command.index("--branch") + 1])
            return self.clone(command, **kwargs)

        job = DummyJob()
        with mock.patch.object(web.subprocess, "run", side_effect=clone):
            web.switch_repository_branch_job(job, self.project, f"import:{URL}#18.0", "dev")

        self.assertEqual(["dev"], branches)
        self.assertEqual("new", (self.storage("alpha") / "code.py").read_text())
        sources = web.read_imported_sources(self.project)
        self.assertEqual({"dev"}, {sources[name]["branch"] for name in ("alpha", "beta")})
        self.assertEqual(
            {"kind": "repository_branch", "repository": "addons", "branch": "dev", "modules": ["alpha", "beta"]},
            job.result,
        )
        with self.assertRaisesRegex(ValueError, "déjà de la branche dev"):
            web.switch_repository_branch_job(DummyJob(), self.project, f"import:{URL}#dev", "dev")

    def test_sdk_archive_is_replaced_by_a_clone_of_the_chosen_branch(self):
        archive = self.storage("sdk-addons")
        (archive / "alpha").mkdir(parents=True)
        (archive / "alpha/__manifest__.py").write_text("{'name': 'Alpha'}")
        (archive / "info.sdk").write_text(json.dumps({"active_branch": "18.0", "remotes": {"origin": URL}}))
        (self.project_root / "odoo/addons/alpha").symlink_to("../addons-store/sdk-addons/alpha")

        def clone(creator, repository, branch, destination, log=None):
            self.assertEqual((URL, "dev"), (repository, branch))
            for name in ("alpha", "gamma"):
                (destination / name).mkdir(parents=True)
                (destination / name / "__manifest__.py").write_text(f"{{'name': '{name}'}}")
            (destination / ".git").mkdir()
            (destination / ".git/HEAD").write_text("ref: refs/heads/dev\n")

        job = DummyJob()
        with mock.patch.object(web.ProjectCreator, "clone", autospec=True, side_effect=clone):
            web.switch_repository_branch_job(job, self.project, str(web.safe_resolve(archive)), "dev")

        self.assertEqual("dev", web.git_checkouts.read_checkout(archive)["branch"])
        self.assertFalse((archive / "info.sdk").exists())
        self.assertTrue((self.project_root / "odoo/addons/gamma/__manifest__.py").is_file(), job.lines)
        backups = list((self.root / ".odoo_manager_backups/repositories" / self.project).iterdir())
        self.assertEqual(1, len(backups))
        self.assertTrue((backups[0] / "info.sdk").is_file())
        self.assertEqual(["alpha", "gamma"], job.result["modules"])

    @unittest.skipUnless(shutil.which("git"), "Git requis")
    def test_git_clone_switches_branch_links_new_modules_and_keeps_local_changes(self):
        def git(*arguments, cwd=None):
            subprocess.run(
                ["git", "-c", "user.name=Test", "-c", "user.email=test@example.org", *arguments],
                cwd=cwd,
                check=True,
                capture_output=True,
            )

        work = self.root / "work"
        work.mkdir()
        git("init", "-q", "-b", "master", cwd=work)
        for name in ("alpha", "beta"):
            (work / name).mkdir()
            (work / name / "__manifest__.py").write_text(f"{{'name': '{name}'}}")
        git("add", ".", cwd=work)
        git("commit", "-q", "-m", "master", cwd=work)
        git("checkout", "-q", "-b", "feature", cwd=work)
        shutil.rmtree(work / "beta")
        (work / "gamma").mkdir()
        (work / "gamma/__manifest__.py").write_text("{'name': 'gamma'}")
        git("add", "-A", ".", cwd=work)
        git("commit", "-q", "-m", "feature", cwd=work)
        git("checkout", "-q", "master", cwd=work)
        origin = self.root / "origin.git"
        git("clone", "-q", "--bare", str(work), str(origin))
        clone = self.storage("addons-repo")
        git("clone", "-q", "--depth", "1", "--single-branch", "--branch", "master", origin.as_uri(), str(clone))
        for name in ("alpha", "beta"):
            (self.project_root / "odoo/addons" / name).symlink_to(f"../addons-store/addons-repo/{name}")
        repository = str(web.safe_resolve(clone))

        branches = web.repository_branches(self.project, repository)
        self.assertEqual("master", branches["current"])
        self.assertEqual(
            [{"name": "master", "default": True}, {"name": "feature", "default": False}], branches["branches"]
        )

        (clone / "alpha/__manifest__.py").write_text("{'name': 'changed'}")
        with self.assertRaisesRegex(RuntimeError, "non enregistrés dans Git"):
            web.switch_repository_branch_job(DummyJob(), self.project, repository, "feature")
        self.assertEqual("master", web.git_checkouts.read_checkout(clone)["branch"])
        git("checkout", "--", "alpha", cwd=clone)

        job = DummyJob()
        web.switch_repository_branch_job(job, self.project, repository, "feature")

        self.assertEqual("feature", web.git_checkouts.read_checkout(clone)["branch"])
        self.assertTrue((self.project_root / "odoo/addons/gamma/__manifest__.py").is_file())
        self.assertTrue(any("Absents de la branche feature (1) : beta" in line for line in job.lines))
        self.assertEqual(["alpha", "gamma"], job.result["modules"])
        # La nouvelle branche est suivie : un `git pull` à la main fonctionne ensuite.
        upstream = subprocess.run(
            ["git", "-C", str(clone), "rev-parse", "--abbrev-ref", "feature@{upstream}"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual("origin/feature", upstream.stdout.strip())

        # Revenir sur master réutilise la branche locale.
        web.switch_repository_branch_job(DummyJob(), self.project, repository, "master")
        self.assertEqual("master", web.git_checkouts.read_checkout(clone)["branch"])
        self.assertTrue((clone / "beta/__manifest__.py").is_file())
