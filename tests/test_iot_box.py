import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import odoo_manager_web as web
from odoo_manager_core import iot_box


class IotBoxRecipeTests(unittest.TestCase):
    def test_unsupported_versions_are_explained(self):
        self.assertEqual(iot_box.unsupported_reason("18.0"), "")
        self.assertIn("16.0", iot_box.unsupported_reason("16.0"))
        self.assertIn("inconnue", iot_box.unsupported_reason(""))

    def test_build_context_keeps_unix_line_endings(self):
        with tempfile.TemporaryDirectory() as directory:
            context = iot_box.write_build_context(Path(directory) / "build")
            self.assertEqual(sorted(p.name for p in context.iterdir()), sorted(iot_box.BUILD_FILES))
            self.assertNotIn(b"\r\n", (context / "entrypoint.sh").read_bytes())

    def test_box_runs_project_code_read_only_with_a_volume_per_version(self):
        arguments = iot_box.run_arguments("demo", "19.0", "traefik-local")
        self.assertIn("./odoo/odoo:/home/pi/odoo:ro", arguments)
        self.assertIn("odoo-manager-iotbox-19.0:/home/pi", arguments)
        self.assertIn("IOTBOX_MODULES=iot_drivers,web", arguments)
        self.assertEqual(arguments[-1], "odoo-manager-iotbox:19.0")


class IotBoxJobTests(unittest.TestCase):
    def test_start_refuses_a_project_on_an_unsupported_version(self):
        with (
            patch.object(web, "validate_project", side_effect=lambda project: project),
            patch.object(web, "project_odoo_version", return_value="16.0"),
            patch.object(web, "run_stream") as run_stream,
        ):
            with self.assertRaisesRegex(RuntimeError, "17.0, 18.0, 19.0"):
                web.start_iotbox_job(object(), "demo")
        run_stream.assert_not_called()

    def test_status_reads_the_box_owner_once(self):
        web.IOTBOX_OWNER = None
        docker = {"running": True}
        traefik = {"running": True, "http_port": 80}
        with (
            patch.object(web, "container_status", return_value="running"),
            patch.object(web, "run_capture", return_value=(0, "demo|19.0\n")) as run_capture,
        ):
            first = web.iotbox_status(docker, traefik)
            web.iotbox_status(docker, traefik)
        self.assertEqual((first["project"], first["version"]), ("demo", "19.0"))
        self.assertEqual(run_capture.call_count, 1)
        with patch.object(web, "container_status", return_value="absent"):
            self.assertEqual(web.iotbox_status(docker, traefik)["project"], "")
        self.assertIsNone(web.IOTBOX_OWNER)


if __name__ == "__main__":
    unittest.main()
