import unittest
from unittest.mock import Mock, patch

import odoo_manager_web as web
from odoo_manager_core import job_queue


class ContainerCommandTests(unittest.TestCase):
    def test_command_targets_selected_container_and_does_not_log_argv(self):
        job = Mock()
        service = Mock()
        service.is_running.return_value = True
        service.docker.side_effect = lambda *args: ["docker", *args]

        def stream(command, log):
            log("$ " + " ".join(command))
            log("/home/odoo\n")
            return 0

        service.stream.side_effect = stream
        with patch.object(web, "validate_project", return_value="DEMO"), patch.object(web, "project_service", return_value=service):
            web.container_command_job(job, "DEMO", "pwd")
        service.docker.assert_called_once_with("exec", "odoo-DEMO", "sh", "-lc", "exec </dev/null\npwd")
        job.add.assert_called_once_with("Commande dans le conteneur Odoo du projet DEMO.")
        job.add_raw.assert_called_once_with("/home/odoo\n")

    def test_raw_command_output_is_preserved_even_when_it_looks_like_git_progress(self):
        job = object.__new__(job_queue.Job)
        job.lines, job.output, job.output_total = [], "", 0
        job.progress, job.control = None, Mock()
        with patch.object(job_queue, "notify_jobs_changed"):
            job.add_raw("Receiving objects: 100% (10/10)\n")
        self.assertEqual(["Receiving objects: 100% (10/10)"], job.lines)
        self.assertIn("Receiving objects: 100% (10/10)", job.output)

    def test_stopped_container_and_failed_command_report_errors(self):
        service = Mock()
        with patch.object(web, "validate_project", return_value="DEMO"), patch.object(web, "project_service", return_value=service):
            service.is_running.return_value = False
            with self.assertRaisesRegex(RuntimeError, "n'est pas démarré"):
                web.container_command_job(Mock(), "DEMO", "pwd")
            service.is_running.return_value = True
            service.stream.return_value = 7
            with self.assertRaisesRegex(RuntimeError, "code 7"):
                web.container_command_job(Mock(), "DEMO", "false")

    def test_invalid_commands_are_rejected_before_job_creation(self):
        with patch.object(web, "payload_project", return_value="DEMO"), patch.object(web, "Job") as job:
            for command in ("", " ", "a\x00b", "a" * 8193, None):
                with self.subTest(command=command), self.assertRaises(ValueError):
                    web.container_command_action({"command": command})
            job.assert_not_called()


if __name__ == "__main__":
    unittest.main()
