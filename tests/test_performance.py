import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import odoo_manager_web as web
from odoo_manager_core import performance
from odoo_manager_core.config import ManagerSettings
from odoo_manager_core.project_service import ProjectService

GIB = performance.GIB


class RecommendationTests(unittest.TestCase):
    def test_docker_gets_what_the_computer_can_spare(self):
        cases = {
            (8 * GIB, 8): (4 * GIB, 6, 2 * GIB),
            (16 * GIB, 10): (10 * GIB, 8, 2 * GIB),
            (32 * GIB, 12): (20 * GIB, 10, 4 * GIB),
            (4 * GIB, 4): (2 * GIB, 4, 2 * GIB),
        }
        for (memory, cpus), expected in cases.items():
            with self.subTest(memory=memory // GIB, cpus=cpus):
                recommended = performance.recommended_docker_resources(memory, cpus)
                self.assertEqual(expected, (recommended["memory"], recommended["cpus"], recommended["swap"]))
        self.assertIsNone(performance.recommended_docker_resources(0, 8))

    def test_status_flags_the_two_gigabytes_default_as_critical(self):
        recommended = performance.recommended_docker_resources(8 * GIB, 8)

        self.assertEqual("critical", performance.resources_status(2066329600, 4, recommended))
        self.assertEqual("low", performance.resources_status(4 * GIB, 4, recommended))
        # Docker annonce un peu moins que la mémoire allouée.
        self.assertEqual("ok", performance.resources_status(int(3.9 * GIB), 6, recommended))

    def test_postgres_settings_follow_docker_memory_and_cpus(self):
        small = performance.postgres_settings(2 * GIB, 4)
        large = performance.postgres_settings(16 * GIB, 8, server_version_num=160000)

        self.assertEqual("256MB", small["shared_buffers"])
        self.assertEqual("128MB", small["maintenance_work_mem"])
        self.assertEqual("16MB", small["work_mem"])
        self.assertEqual("2048MB", large["shared_buffers"])
        self.assertEqual("1024MB", large["maintenance_work_mem"])
        self.assertEqual("4", large["max_parallel_maintenance_workers"])
        self.assertNotIn("max_parallel_maintenance_workers", performance.postgres_settings(4 * GIB, 4, 100000))
        self.assertTrue(set(large) <= set(performance.POSTGRES_TUNED_SETTINGS))

    def test_linux_memory_comes_from_meminfo(self):
        self.assertEqual(16 * GIB, performance.linux_total_memory("MemTotal:       16777216 kB\nMemFree: 1 kB\n"))

    def test_wsl_reads_the_windows_computer_from_the_application(self):
        variables = {performance.HOST_MEMORY_VARIABLE: str(32 * GIB), performance.HOST_CPUS_VARIABLE: "16"}
        with (
            patch.object(performance, "running_in_wsl", return_value=True),
            patch.object(performance.os, "cpu_count", return_value=8),
            patch.dict(performance.os.environ, variables),
        ):
            self.assertEqual({"memory": 32 * GIB, "cpus": 16}, performance.host_resources("Linux"))
        with (
            patch.object(performance, "running_in_wsl", return_value=True),
            patch.object(performance.os, "cpu_count", return_value=8),
            patch.dict(performance.os.environ, clear=True),
        ):
            self.assertEqual({"memory": 0, "cpus": 8}, performance.host_resources("Linux"))


class DockerDesktopSettingsTests(unittest.TestCase):
    def test_writes_only_resources_and_keeps_a_larger_swap(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings-store.json"
            path.write_text(
                json.dumps({"AutoStart": False, "Cpus": 4, "MemoryMiB": 2048, "SwapMiB": 4096, "DiskSizeMiB": 131072}),
                encoding="utf-8",
            )
            # L'ancien fichier, périmé, ne doit être ni lu ni modifié.
            (Path(directory) / "settings.json").write_text('{"memoryMiB": 4096, "cpus": 8}', encoding="utf-8")

            written = performance.write_docker_desktop_resources(4 * GIB, 6, 2 * GIB, directory)
            payload = json.loads(path.read_text(encoding="utf-8"))
            backup = json.loads((Path(directory) / "settings-store.json.odoo-manager.bak").read_text(encoding="utf-8"))
            legacy = (Path(directory) / "settings.json").read_text(encoding="utf-8")

        self.assertEqual(path, written)
        self.assertEqual(
            {"AutoStart": False, "Cpus": 6, "MemoryMiB": 4096, "SwapMiB": 4096, "DiskSizeMiB": 131072}, payload
        )
        self.assertEqual(2048, backup["MemoryMiB"])
        self.assertEqual('{"memoryMiB": 4096, "cpus": 8}', legacy)

    def test_older_docker_desktop_uses_lowercase_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text('{"memoryMiB": 2048, "cpus": 2, "swapMiB": 1024}', encoding="utf-8")
            performance.write_docker_desktop_resources(4 * GIB, 4, 2 * GIB, directory)
            payload = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual({"memoryMiB": 4096, "cpus": 4, "swapMiB": 2048}, payload)

    def test_missing_or_protected_settings_are_explained(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "Confidentialité et sécurité"):
                performance.write_docker_desktop_resources(4 * GIB, 4, 2 * GIB, directory)
            path = Path(directory) / "settings-store.json"
            path.write_text("{}", encoding="utf-8")
            with patch.object(Path, "read_text", side_effect=PermissionError("Operation not permitted")):
                with self.assertRaisesRegex(RuntimeError, "autorise SDK Local Manager"):
                    performance.check_docker_desktop_settings(directory)


class TunePostgresTests(unittest.TestCase):
    def service(self, tune=True, auto_conf=(), pending="0", odoo_state="absent"):
        runner = Mock()
        self.commands = []

        def capture(command, cwd=None, timeout=10):
            command = list(command)
            self.commands.append(command)
            text = " ".join(command)
            if "pg_file_settings" in text:
                return 0, "\n".join(auto_conf)
            if "server_version_num" in text:
                return 0, "160004"
            if "{{.MemTotal}} {{.NCPU}}" in text:
                return 0, f"{4 * GIB} 4"
            if "pending_restart" in text:
                return 0, pending
            if "odoo-manager-state:" in text:
                return 0, f"odoo-manager-state:{odoo_state}"
            if "{{.State.Status}}" in text:
                return 0, "running"
            return 0, ""

        runner.capture.side_effect = capture
        runner.stream.return_value = 0
        settings = ManagerSettings.from_dict({"tune_postgres": tune}, "/tmp")
        return ProjectService(settings, Path("/tmp"), runner=runner)

    def alter_statements(self):
        return [
            command[index + 1]
            for command in self.commands
            for index, argument in enumerate(command)
            if argument == "-c" and command[index + 1].startswith("ALTER SYSTEM")
        ]

    def setUp(self):
        patcher = patch.dict("odoo_manager_core.project_service.DOCKER_RESOURCES_CACHE", clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_writes_each_setting_in_its_own_command_and_reloads(self):
        service = self.service()

        self.assertTrue(service.tune_postgres("DEMO", log=lambda _line: None))

        statements = self.alter_statements()
        self.assertIn("ALTER SYSTEM SET shared_buffers = '512MB';", statements)
        self.assertIn("ALTER SYSTEM SET synchronous_commit = 'off';", statements)
        self.assertTrue(any("SELECT pg_reload_conf();" in command for command in self.commands))

    def test_nothing_is_written_when_postgres_already_has_the_settings(self):
        wanted = performance.postgres_settings(4 * GIB, 4, 160004)
        service = self.service(auto_conf=[f"{name}|{value}" for name, value in wanted.items()])

        self.assertFalse(service.tune_postgres("DEMO", log=lambda _line: None))
        self.assertEqual([], self.alter_statements())

    def test_disabling_the_setting_removes_only_what_the_manager_wrote(self):
        service = self.service(tune=False, auto_conf=["shared_buffers|512MB", "log_statement|all"])

        self.assertTrue(service.tune_postgres("DEMO", log=lambda _line: None))
        self.assertEqual(["ALTER SYSTEM RESET shared_buffers;"], self.alter_statements())

    def test_restarts_postgres_for_the_new_cache_only_when_odoo_is_stopped(self):
        service = self.service(pending="1", odoo_state="running")
        logs = []
        service.tune_postgres("DEMO", log=logs.append)
        service.runner.stream.assert_not_called()
        self.assertTrue(any("prochain démarrage" in line for line in logs))

        service = self.service(pending="1", odoo_state="absent")
        with patch.object(service, "wait_for_postgres") as wait:
            service.tune_postgres("DEMO", log=lambda _line: None)
        restart = service.runner.stream.call_args.args[0]
        self.assertEqual(["restart", "postgresql-DEMO"], restart[-2:])
        wait.assert_called_once()


class PerformancePayloadTests(unittest.TestCase):
    def test_macos_payload_proposes_the_recommendation(self):
        service = Mock()
        service.docker_resources.return_value = (2066329600, 4)
        with (
            patch.object(web, "platform_id", return_value="macos"),
            patch.object(web, "project_service", return_value=service),
            patch.object(performance, "host_resources", return_value={"memory": 8 * GIB, "cpus": 8}),
        ):
            payload = web.performance_payload()

        self.assertEqual("critical", payload["status"])
        self.assertTrue(payload["can_apply"])
        self.assertEqual({"memory": 4 * GIB, "cpus": 6, "swap": 2 * GIB}, payload["recommended"])

    def test_windows_payload_leaves_the_application_to_apply(self):
        service = Mock()
        service.docker_resources.return_value = (8 * GIB, 16)
        with (
            patch.object(web, "platform_id", return_value="windows"),
            patch.object(web, "project_service", return_value=service),
            patch.object(performance, "host_resources", return_value={"memory": 16 * GIB, "cpus": 16}),
        ):
            payload = web.performance_payload()

        self.assertFalse(payload["can_apply"])
        self.assertEqual({"memory": 10 * GIB, "cpus": 14, "swap": 2 * GIB}, payload["recommended"])

    def test_wsl_payload_recommends_from_the_windows_computer(self):
        service = Mock()
        service.docker_resources.return_value = (16 * GIB, 12)
        with (
            patch.object(web, "platform_id", return_value="linux"),
            patch.object(performance, "running_in_wsl", return_value=True),
            patch.object(web, "project_service", return_value=service),
            patch.object(performance, "host_resources", return_value={"memory": 32 * GIB, "cpus": 12}),
        ):
            payload = web.performance_payload()

        self.assertEqual(("wsl", "low"), (payload["environment"], payload["status"]))
        self.assertEqual({"memory": 20 * GIB, "cpus": 10, "swap": 4 * GIB}, payload["recommended"])
        self.assertFalse(payload["can_apply"])

    def test_native_linux_docker_needs_nothing(self):
        service = Mock()
        service.docker_resources.return_value = (32 * GIB, 12)
        with (
            patch.object(web, "platform_id", return_value="linux"),
            patch.object(performance, "running_in_wsl", return_value=False),
            patch.object(web, "project_service", return_value=service),
        ):
            payload = web.performance_payload()

        self.assertEqual(("linux", "ok", None), (payload["environment"], payload["status"], payload["recommended"]))


class ApplyDockerResourcesTests(unittest.TestCase):
    def test_stops_docker_desktop_before_writing_then_restarts_it(self):
        events = []
        service = Mock()
        service.docker_resources.side_effect = [(2 * GIB, 4), (int(3.9 * GIB), 6)]
        service.stream.side_effect = lambda command, log=None: events.append(" ".join(command[-3:])) or 0
        backend_running = iter([True, False])
        job = Mock()

        with (
            patch.object(web, "platform_id", return_value="macos"),
            patch.object(web, "project_service", return_value=service),
            patch.object(performance, "host_resources", return_value={"memory": 8 * GIB, "cpus": 8}),
            patch.object(web, "docker_desktop_cli_available", return_value=True),
            patch.object(web, "docker_desktop_backend_running", side_effect=lambda: next(backend_running, False)),
            patch.object(web, "docker_engine_answers", return_value=True),
            patch.object(web, "run_capture", return_value=(0, "odoo-aca_v16\ntraefik\nodoo-DEMO")),
            patch.object(
                performance,
                "write_docker_desktop_resources",
                side_effect=lambda *args: events.append(("write", args)) or Path("/settings-store.json"),
            ),
            patch.object(performance, "check_docker_desktop_settings", side_effect=lambda: events.append("check")),
            patch.object(web.job_control, "sleep"),
        ):
            web.apply_docker_resources_job(job)

        self.assertEqual("check", events[0])
        self.assertEqual("stop --timeout 180", events[1])
        self.assertEqual(("write", (4 * GIB, 6, 2 * GIB)), events[2])
        self.assertEqual("desktop start --detach", events[3])
        logged = " ".join(call.args[0] for call in job.add.call_args_list)
        self.assertIn("aca_v16, DEMO", logged)
        self.assertIn("4 Go et 6 processeurs", logged)

    def test_docker_desktop_is_restarted_even_when_the_settings_cannot_be_written(self):
        service = Mock()
        service.docker_resources.return_value = (2 * GIB, 4)
        service.stream.return_value = 0
        with (
            patch.object(web, "platform_id", return_value="macos"),
            patch.object(web, "project_service", return_value=service),
            patch.object(performance, "host_resources", return_value={"memory": 8 * GIB, "cpus": 8}),
            patch.object(web, "docker_desktop_cli_available", return_value=True),
            patch.object(web, "docker_desktop_backend_running", return_value=False),
            patch.object(web, "docker_engine_answers", return_value=True),
            patch.object(web, "run_capture", return_value=(0, "")),
            patch.object(performance, "check_docker_desktop_settings"),
            patch.object(performance, "write_docker_desktop_resources", side_effect=RuntimeError("disque plein")),
            patch.object(web.job_control, "sleep"),
        ):
            with self.assertRaisesRegex(RuntimeError, "disque plein"):
                web.apply_docker_resources_job(Mock())

        self.assertEqual(["desktop", "start", "--detach"], service.stream.call_args.args[0][-3:])

    def test_refuses_outside_macos(self):
        with patch.object(web, "platform_id", return_value="windows"):
            with self.assertRaisesRegex(RuntimeError, "que sous macOS"):
                web.apply_docker_resources_job(Mock())


if __name__ == "__main__":
    unittest.main()
