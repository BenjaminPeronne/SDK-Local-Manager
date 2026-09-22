import os
import tempfile
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from odoo_manager_core.migration import (
    MIGRATION_MARKER,
    compare_projects,
    copy_project,
    copy_project_privileged,
    list_tree,
    is_project_directory,
    measure_project,
    migration_candidates,
    container_state_of,
    project_status,
    legacy_engine_states,
)


def build_project(root, name, *, running=False, with_links=True):
    """Projet minimal, à l'image d'un projet réel : code, liens d'addons, base, filestore."""
    project = root / name
    (project / "odoo" / "addons-store" / "mon_module").mkdir(parents=True)
    (project / "odoo" / "addons").mkdir(parents=True)
    (project / "odoo" / "addons-store" / "mon_module" / "__manifest__.py").write_text("{'name': 'mon'}", encoding="utf-8")
    (project / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
    (project / "odoo.conf").write_text("[options]\n", encoding="utf-8")
    data = project / "postgresql_data"
    data.mkdir()
    (data / "PG_VERSION").write_text("14\n", encoding="utf-8")
    if running:
        (data / "postmaster.pid").write_text("42\n", encoding="utf-8")
    (project / "odoo_data" / "filestore" / "test").mkdir(parents=True)
    (project / "odoo_data" / "filestore" / "test" / "a1").write_text("piece jointe", encoding="utf-8")
    if with_links:
        # Séparateur natif : Windows ne suit pas un lien dont la cible utilise des barres obliques.
        target = os.path.join("..", "addons-store", "mon_module")
        os.symlink(target, project / "odoo" / "addons" / "mon_module", target_is_directory=True)
    return project


@unittest.skipUnless(
    os.name != "nt" or os.environ.get("ODOO_MANAGER_SYMLINKS_OK") or hasattr(os, "symlink"),
    "Les liens symboliques doivent être autorisés.",
)
class ProjectMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.windows = Path(self.temporary.name) / "windows"
        self.linux = Path(self.temporary.name) / "linux"
        self.windows.mkdir()
        self.linux.mkdir()
        self.addCleanup(self.temporary.cleanup)

    def test_only_odoo_projects_are_proposed(self):
        build_project(self.windows, "CLIENT_A")
        (self.windows / "notes").mkdir()
        (self.windows / ".odoo_manager_staging").mkdir()

        candidates = migration_candidates(self.windows, self.linux)

        self.assertEqual(["CLIENT_A"], [candidate["name"] for candidate in candidates])
        self.assertFalse(candidates[0]["already_migrated"])
        self.assertTrue(candidates[0]["stopped"])

    def test_a_running_project_is_reported_as_such(self):
        # Copier postgresql_data pendant que PostgreSQL écrit donnerait une base incohérente.
        build_project(self.windows, "CLIENT_B", running=True)
        self.assertFalse(migration_candidates(self.windows, self.linux)[0]["stopped"])
        self.assertFalse(project_status(self.windows / "CLIENT_B")[0])

    def test_an_already_migrated_project_is_flagged(self):
        build_project(self.windows, "CLIENT_C")
        (self.linux / "CLIENT_C").mkdir()
        self.assertTrue(migration_candidates(self.windows, self.linux)[0]["already_migrated"])

    def test_copy_keeps_links_relative_and_leaves_the_original_intact(self):
        source = build_project(self.windows, "CLIENT_D")
        before = measure_project(source)

        copy_project(source, self.linux / "CLIENT_D")

        link = self.linux / "CLIENT_D" / "odoo" / "addons" / "mon_module"
        self.assertTrue(link.is_symlink())
        self.assertEqual("../addons-store/mon_module", os.readlink(link).replace(os.sep, "/"))
        # Le lien désigne bien la copie, pas l'original.
        self.assertTrue((link / "__manifest__.py").exists())
        self.assertEqual(before, measure_project(source))
        self.assertTrue((self.linux / "CLIENT_D" / MIGRATION_MARKER).exists())

    def test_copy_brings_the_database_and_the_filestore(self):
        source = build_project(self.windows, "CLIENT_E")
        copy_project(source, self.linux / "CLIENT_E")
        self.assertEqual("14\n", (self.linux / "CLIENT_E" / "postgresql_data" / "PG_VERSION").read_text(encoding="utf-8"))
        self.assertEqual(
            "piece jointe",
            (self.linux / "CLIENT_E" / "odoo_data" / "filestore" / "test" / "a1").read_text(encoding="utf-8"),
        )

    def test_comparison_confirms_an_identical_copy(self):
        source = build_project(self.windows, "CLIENT_F")
        copy_project(source, self.linux / "CLIENT_F")

        comparison = compare_projects(source, self.linux / "CLIENT_F")

        self.assertTrue(comparison["identical"], comparison)
        self.assertEqual(comparison["source_files"], comparison["copied_files"])

    def test_comparison_catches_a_missing_file_and_a_changed_link(self):
        source = build_project(self.windows, "CLIENT_G")
        destination = self.linux / "CLIENT_G"
        copy_project(source, destination)
        (destination / "odoo.conf").unlink()
        link = destination / "odoo" / "addons" / "mon_module"
        link.unlink()
        os.symlink(os.path.join(os.sep, "ailleurs", "mon_module"), link, target_is_directory=True)

        comparison = compare_projects(source, destination)

        self.assertFalse(comparison["identical"])
        self.assertEqual(["odoo.conf"], comparison["missing"])
        self.assertEqual(["odoo/addons/mon_module"], comparison["different_links"])

    def test_copying_over_an_existing_project_is_refused(self):
        source = build_project(self.windows, "CLIENT_H")
        (self.linux / "CLIENT_H").mkdir()
        with self.assertRaises(ValueError):
            copy_project(source, self.linux / "CLIENT_H")

    def test_progress_is_reported_during_a_long_copy(self):
        source = build_project(self.windows, "CLIENT_I")
        lines = []
        copy_project(source, self.linux / "CLIENT_I", log=lines.append)
        self.assertTrue(any("Copie terminée" in line for line in lines))

    def test_a_directory_without_compose_is_not_a_project(self):
        (self.windows / "vide").mkdir()
        self.assertFalse(is_project_directory(self.windows / "vide"))


SUDO = ["/usr/bin/sudo", "-n"]
# Sortie de `docker ps -a` sur le moteur d'origine, vue depuis la distribution.
LEGACY_PS_OUTPUT = """postgresql-Caritel|exited
traefik|running
"""


def completed(stdout="", returncode=0):
    return subprocess.CompletedProcess([], returncode, stdout, "")


class PrivilegedMigrationTests(unittest.TestCase):
    """Relevé réel sous WSL : postgresql_data appartient à l'uid 999 en 0700, illisible pour `sdk`."""

    def test_an_unreadable_lock_is_checked_through_sudo(self):
        calls = []

        def run(command, **_kwargs):
            calls.append(command)
            return completed("running\n")

        with mock.patch.object(Path, "exists", side_effect=PermissionError(13, "Permission denied")):
            self.assertFalse(project_status("/mnt/c/p/SIMPAC", SUDO, run)[0])
        self.assertEqual(SUDO, calls[0][:2])
        self.assertEqual(str(Path("/mnt/c/p/SIMPAC") / "postgresql_data" / "postmaster.pid"), calls[0][-1])

    def test_a_stopped_project_is_recognised_through_sudo(self):
        with mock.patch.object(Path, "exists", side_effect=PermissionError(13, "Permission denied")):
            self.assertTrue(project_status("/mnt/c/p/DEMO", SUDO, lambda *_a, **_k: completed("stopped\n"))[0])

    def test_an_unreadable_lock_without_sudo_blocks_the_migration(self):
        with mock.patch.object(Path, "exists", side_effect=PermissionError(13, "Permission denied")):
            self.assertFalse(project_status("/mnt/c/p/DEMO", [], lambda *_a, **_k: completed("stopped\n"))[0])

    def test_a_failing_sudo_never_reads_as_stopped(self):
        with mock.patch.object(Path, "exists", side_effect=PermissionError(13, "Permission denied")):
            self.assertFalse(project_status("/mnt/c/p/DEMO", SUDO, lambda *_a, **_k: completed("", returncode=1))[0])

    def listing(self):
        return completed(
            "docker-compose.yml\tf\t120\t\n"
            "postgresql_data\td\t4096\t\n"
            "postgresql_data/PG_VERSION\tf\t3\t\n"
            "odoo/addons/account\tl\t30\t../addons-store/odoo/addons/account\n"
        )

    def test_tree_listing_keeps_types_sizes_and_link_targets(self):
        entries = list_tree("/mnt/c/p/DEMO", SUDO, lambda *_a, **_k: self.listing())
        self.assertEqual(("l", 30, "../addons-store/odoo/addons/account"), entries["odoo/addons/account"])
        self.assertEqual(("d", 4096, ""), entries["postgresql_data"])

    def test_measure_counts_files_and_links_but_not_directories(self):
        measured = measure_project("/mnt/c/p/DEMO", SUDO, lambda *_a, **_k: self.listing())
        self.assertEqual({"files": 3, "bytes": 123}, measured)

    def test_comparison_through_sudo_sees_the_database_files(self):
        identical = compare_projects("/src", "/dst", SUDO, lambda *_a, **_k: self.listing())
        self.assertTrue(identical["identical"])

        def run(command, **_kwargs):
            return self.listing() if "/src" in command else completed("docker-compose.yml\tf\t120\t\n")

        truncated = compare_projects("/src", "/dst", SUDO, run)
        self.assertFalse(truncated["identical"])
        self.assertIn("postgresql_data/PG_VERSION", truncated["missing"])

    def test_the_source_is_listed_once_for_measure_and_comparison(self):
        # À travers /mnt/c, lister un projet Enterprise prend près de deux minutes.
        listed = []

        def run(command, **_kwargs):
            listed.append(command[3])
            return self.listing()

        listing = list_tree("/src", SUDO, run)
        measure_project("/src", SUDO, run, listing=listing)
        compare_projects("/src", "/dst", SUDO, run, source_listing=listing)
        self.assertEqual(["/src", "/dst"], listed)

    def test_privileged_copy_preserves_owners_and_marks_the_copy(self):
        calls = []

        class Process:
            returncode = 0

            def communicate(self, timeout=None):
                return "", ""

        def popen(command, **_kwargs):
            calls.append(command)
            return Process()

        def run(command, **_kwargs):
            calls.append(command)
            return completed()

        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "DEMO"
            copy_project_privileged("/mnt/c/p/DEMO", destination, SUDO, popen=popen, run=run)

        self.assertEqual([*SUDO, "bash", "-c"], calls[0][:4])
        self.assertIn("pipefail", calls[0][4])
        self.assertIn("--numeric-owner -xpf", calls[0][4])
        self.assertEqual([str(Path("/mnt/c/p/DEMO")), str(destination)], calls[0][-2:])
        self.assertTrue(calls[1][-1].endswith(MIGRATION_MARKER))

    def test_a_failed_privileged_copy_is_reported(self):
        class Process:
            returncode = 1

            def communicate(self, timeout=None):
                return "", "cp: cannot stat: No space left on device"

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(RuntimeError, "No space left"):
                copy_project_privileged("/src", Path(temporary) / "DEMO", SUDO,
                                        popen=lambda *_a, **_k: Process(), run=lambda *_a, **_k: completed())


class ContainerStateTests(unittest.TestCase):
    """Relevé réel : `postgresql-Caritel` en « Exited (255) » et un postmaster.pid du 12 septembre.

    Le conteneur avait été tué avec Docker, sans laisser PostgreSQL effacer son verrou : le
    projet restait affiché « en cours d'exécution », donc ni migrable ni arrêtable.
    """

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.windows = Path(self.temporary.name) / "windows"
        self.linux = Path(self.temporary.name) / "linux"
        self.windows.mkdir()
        self.linux.mkdir()
        self.addCleanup(self.temporary.cleanup)

    def test_a_stale_lock_no_longer_blocks_a_killed_project(self):
        build_project(self.windows, "CARITEL", running=True, with_links=False)
        candidates = migration_candidates(self.windows, self.linux, container_state=lambda _name: "exited")
        self.assertTrue(candidates[0]["stopped"])

    def test_a_running_container_blocks_the_migration_even_without_a_lock(self):
        build_project(self.windows, "DEMO_01", with_links=False)
        self.assertFalse(project_status(self.windows / "DEMO_01", container_state=lambda _name: "running")[0])

    def test_a_container_unknown_to_this_engine_leaves_the_lock_in_charge(self):
        # Le projet peut tourner sous Docker Desktop pendant que le backend interroge la distribution.
        build_project(self.windows, "SIMPAC", running=True, with_links=False)
        self.assertFalse(project_status(self.windows / "SIMPAC", container_state=lambda _name: "absent")[0])

    def test_an_unreachable_engine_leaves_the_lock_in_charge(self):
        build_project(self.windows, "SIMPAC", running=True, with_links=False)
        self.assertFalse(project_status(self.windows / "SIMPAC", container_state=lambda _name: None)[0])

    def test_an_unconfirmed_lock_is_flagged_for_the_interface(self):
        build_project(self.windows, "CARITEL", running=True, with_links=False)
        candidate = migration_candidates(self.windows, self.linux, container_state=lambda _name: "absent")[0]
        self.assertFalse(candidate["stopped"])
        self.assertFalse(candidate["engine_confirmed"])

    def test_a_state_read_from_an_engine_is_confirmed(self):
        build_project(self.windows, "DEMO_01", running=True, with_links=False)
        self.assertEqual((True, True), project_status(self.windows / "DEMO_01", container_state=lambda _name: "exited"))
        self.assertEqual((False, True), project_status(self.windows / "DEMO_01", container_state=lambda _name: "running"))

    def test_the_engine_is_asked_about_the_project_name(self):
        build_project(self.windows, "CARITEL", running=True, with_links=False)
        asked = []

        def state(name):
            asked.append(name)
            return "exited"

        migration_candidates(self.windows, self.linux, container_state=state)
        self.assertEqual(["CARITEL"], asked)


class LegacyEngineTests(unittest.TestCase):
    """Relevé réel : depuis la distribution, `postgresql-Caritel` n'existe que pour Docker Desktop."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.socket = Path(self.temporary.name) / "docker.proxy.sock"
        self.socket.write_text("", encoding="utf-8")
        self.addCleanup(self.temporary.cleanup)

    def test_the_original_engine_is_read_through_sudo_on_its_own_socket(self):
        calls = []

        def run(command, **_kwargs):
            calls.append(command)
            return completed(LEGACY_PS_OUTPUT)

        states = legacy_engine_states(SUDO, run, str(self.socket))

        self.assertEqual({"postgresql-Caritel": "exited", "traefik": "running"}, states)
        self.assertEqual(SUDO, calls[0][:2])
        self.assertIn(f"unix://{self.socket}", calls[0])

    def test_no_socket_means_no_second_engine_and_no_docker_call(self):
        called = []
        states = legacy_engine_states(SUDO, lambda *_a, **_k: called.append(1) or completed(), "/introuvable/docker.sock")
        self.assertEqual({}, states)
        self.assertEqual([], called)

    def test_an_unreachable_engine_is_not_an_answer(self):
        self.assertEqual({}, legacy_engine_states(SUDO, lambda *_a, **_k: completed("", returncode=1), str(self.socket)))

    def test_a_project_is_running_as_soon_as_one_of_its_containers_runs(self):
        self.assertEqual("running", container_state_of({"postgresql-DEMO_01": "running"}, "DEMO_01"))
        self.assertEqual("running", container_state_of({"odoo-DEMO_01": "running", "postgresql-DEMO_01": "exited"}, "DEMO_01"))

    def test_a_killed_project_keeps_its_last_known_state(self):
        self.assertEqual("exited", container_state_of({"postgresql-CARITEL": "exited"}, "CARITEL"))

    def test_an_unknown_project_and_a_silent_engine_are_distinguished(self):
        self.assertEqual("absent", container_state_of({"traefik": "running"}, "CARITEL"))
        self.assertIsNone(container_state_of(None, "CARITEL"))


if __name__ == "__main__":
    unittest.main()
