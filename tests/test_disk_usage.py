import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import odoo_manager_web as web
from odoo_manager_core.disk_usage import (
    compose_image_references,
    parse_docker_size,
    parse_du_output,
    trash_entry,
    unused_images,
)


def image(image_id, repository, tag, size=100):
    return {"id": image_id, "repository": repository, "tag": tag, "bytes": size, "created": ""}


class DiskUsageParsingTests(unittest.TestCase):
    def test_du_output_is_read_in_kilobytes(self):
        output = "1024\t/w/DEMO/postgresql_data\n2048\t/w/DEMO/odoo\n4096\t/w/DEMO\n"

        self.assertEqual(
            {"/w/DEMO/postgresql_data": 1048576, "/w/DEMO/odoo": 2097152, "/w/DEMO": 4194304},
            parse_du_output(output),
        )

    def test_docker_sizes_use_decimal_units(self):
        self.assertEqual(1_200_000_000, parse_docker_size("1.2GB"))
        self.assertEqual(512_000_000, parse_docker_size("512MB"))
        self.assertEqual(0, parse_docker_size("0B"))
        # `docker system df` ajoute la part récupérable entre parenthèses.
        self.assertEqual(3_400_000_000, parse_docker_size("3.4GB (100%)"))
        self.assertEqual(0, parse_docker_size("illisible"))

    def test_trash_entries_carry_the_project_and_the_deletion_date(self):
        self.assertEqual(
            {"name": "20260923_160146_genergies_v19", "project": "genergies_v19", "deleted_at": "2026-09-23 16:01"},
            trash_entry("20260923_160146_genergies_v19"),
        )
        self.assertIsNone(trash_entry(".DS_Store"))
        self.assertIsNone(trash_entry("20260923_160146_../etc"))

    def test_compose_images_are_normalized_with_their_tag(self):
        text = "services:\n  db:\n    image: postgres:16\n  odoo:\n    image: 'sudokeys/docker-odoo-local:18.0'\n  x:\n    image: redis\n"

        self.assertEqual(
            {"postgres:16", "sudokeys/docker-odoo-local:18.0", "redis:latest"}, compose_image_references(text)
        )


class UnusedImagesTests(unittest.TestCase):
    def test_images_declared_by_a_stopped_project_are_kept(self):
        # Une image docker-odoo-local peut ne plus être téléchargeable : un projet arrêté la garde.
        images = [
            image("sha256:a", "sudokeys/docker-odoo-local", "17.0"),
            image("sha256:b", "sudokeys/docker-odoo-local", "16.0"),
            image("sha256:c", "postgres", "16"),
            image("sha256:d", "<none>", "<none>"),
        ]

        unused = unused_images(images, used_image_ids={"sha256:c"}, referenced={"sudokeys/docker-odoo-local:17.0"})

        self.assertEqual(
            [("sha256:b", "sudokeys/docker-odoo-local:16.0"), ("sha256:d", "image orpheline")],
            [(row["id"], row["reference"]) for row in unused],
        )

    def test_an_image_used_by_a_container_is_never_proposed(self):
        self.assertEqual([], unused_images([image("sha256:a", "old", "1")], {"sha256:a"}, set()))


class DiskCleanupJobTests(unittest.TestCase):
    class LogJob:
        def __init__(self):
            self.lines = []

        def add(self, line):
            self.lines.append(line)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name)
        self.trash = self.workspace / ".odoo_manager_deleted"
        (self.trash / "20260923_160146_DEMO" / "postgresql_data").mkdir(parents=True)
        for patcher in (
            patch.object(web, "WORKSPACE", self.workspace),
            patch.object(web, "DELETED_PROJECTS", self.trash),
            patch.object(web, "DISK_USAGE", {"report": None}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def tearDown(self):
        self.temporary.cleanup()

    def test_purge_removes_only_the_requested_trash_entries(self):
        (self.trash / "20260924_075828_KEEP").mkdir()

        web.purge_deleted_projects_job(self.LogJob(), ["20260923_160146_DEMO"])

        self.assertEqual(["20260924_075828_KEEP"], [child.name for child in self.trash.iterdir()])

    def test_purge_refuses_a_path_outside_the_trash(self):
        with self.assertRaises(ValueError):
            web.purge_deleted_projects_job(self.LogJob(), ["../DEMO"])

    @patch("odoo_manager_web.clear_project_module_cache")
    def test_restore_moves_the_project_back_under_its_name(self, _clear_cache):
        web.restore_deleted_project_job(self.LogJob(), "20260923_160146_DEMO")

        self.assertTrue((self.workspace / "DEMO" / "postgresql_data").is_dir())
        self.assertFalse((self.trash / "20260923_160146_DEMO").exists())

    def test_restore_never_overwrites_an_existing_project(self):
        (self.workspace / "DEMO").mkdir()

        with self.assertRaisesRegex(RuntimeError, "existe déjà"):
            web.restore_deleted_project_job(self.LogJob(), "20260923_160146_DEMO")

    def test_emptying_a_manager_folder_keeps_the_folder_itself(self):
        failures = self.workspace / ".odoo_manager_failures"
        failures.mkdir()
        (failures / "echec.log").write_text("x", encoding="utf-8")

        web.purge_manager_folder_job(self.LogJob(), "failures")

        self.assertTrue(failures.is_dir())
        self.assertEqual([], list(failures.iterdir()))

    def test_unknown_manager_folders_are_refused(self):
        with self.assertRaises(ValueError):
            web.purge_manager_folder_job(self.LogJob(), "../../etc")

    @patch("odoo_manager_web.run_stream", return_value=0)
    @patch("odoo_manager_web.docker_command", side_effect=lambda _settings, *args: ["docker", *args])
    @patch("odoo_manager_web.docker_images_snapshot")
    def test_images_used_since_the_scan_are_not_removed(self, snapshot, _docker_command, run_stream):
        unused = [{**image("sha256:b", "old", "1"), "reference": "old:1"}]
        snapshot.return_value = ([], unused)
        job = self.LogJob()

        web.remove_docker_images_job(job, ["sha256:b", "sha256:now-used"])

        run_stream.assert_called_once_with(job, ["docker", "rmi", "old:1"])
        self.assertTrue(any("conservée" in line for line in job.lines))


class ICloudDetectionTests(unittest.TestCase):
    def test_a_workspace_in_documents_synced_by_icloud_is_detected(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            workspace = home / "Documents" / "Developer" / "Odoo-projects"
            workspace.mkdir(parents=True)
            cloud = home / "Library" / "Mobile Documents" / "com~apple~CloudDocs"
            cloud.mkdir(parents=True)
            with (
                patch("odoo_manager_web.platform_id", return_value="macos"),
                patch("odoo_manager_web.Path.home", return_value=home),
                patch.object(web, "WORKSPACE", workspace),
            ):
                self.assertFalse(web.workspace_synced_by_icloud())
                # « Bureau et Documents » activé : iCloud Drive pointe vers ~/Documents.
                (cloud / "Documents").symlink_to(home / "Documents")
                self.assertTrue(web.workspace_synced_by_icloud())

    @patch("odoo_manager_web.platform_id", return_value="linux")
    def test_other_systems_are_never_reported(self, _platform):
        self.assertFalse(web.workspace_synced_by_icloud())

    @patch("odoo_manager_web.workspace_synced_by_icloud", return_value=True)
    @patch("odoo_manager_web.mailpit_status", return_value={})
    @patch("odoo_manager_web.traefik_status", return_value={"running": False})
    def test_the_system_status_reports_it_without_a_disk_scan(self, _traefik, _mailpit, _icloud):
        # Le bandeau de l'écran principal en dépend : il ne doit pas attendre une analyse du disque.
        self.assertTrue(web.system_status_snapshot({"running": False})["workspace_icloud_synced"])


if __name__ == "__main__":
    unittest.main()
