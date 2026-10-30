import unittest
from unittest.mock import Mock, patch

import odoo_manager_web as web


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
        self.assertEqual(["Commande dans le conteneur Odoo du projet DEMO.", "/home/odoo\n"], [call.args[0] for call in job.add.call_args_list])

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
