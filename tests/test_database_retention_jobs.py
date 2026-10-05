import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import odoo_manager_web as web
from odoo_manager_core.database_retention import RETENTION_SECONDS, RetentionStore


class LogJob:
    def __init__(self):
        self.lines = []
        self.result = {}

    def add(self, line):
        self.lines.append(line)


class RecordedJob:
    """Remplace Job : enregistre l'action au lieu de la lancer."""

    created = []

    def __init__(self, title, target, args=(), project=None, resources=None):
        self.title, self.target, self.args, self.project, self.resources = title, target, args, project, resources
        RecordedJob.created.append(self)


class RetentionTestCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name) / "projects"
        self.workspace.mkdir()
        self.store = RetentionStore(Path(temporary.name) / "database_retention.json")
        for patcher in (
            patch.object(web, "WORKSPACE", self.workspace),
            patch.object(web, "DELETED_PROJECTS", self.workspace / ".odoo_manager_deleted"),
            patch.object(web, "DATABASE_RETENTION", self.store),
            patch.dict(web.RETENTION_FAILURES, clear=True),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def state(self, project):
        return self.store.project_state(str(self.workspace), project)


class DatabaseOidsTests(RetentionTestCase):
    @patch("odoo_manager_web.run_capture", return_value=(0, "5|postgres\n16384|prod\n16400|test_copy\n"))
    def test_oids_are_read_from_postgresql(self, _run):
        self.assertEqual(
            {"postgres": 5, "prod": 16384, "test_copy": 16400}, web.database_oids_for("CLIENT", check_container=False)
        )

    @patch("odoo_manager_web.run_capture", return_value=(1, "connexion refusée"))
    def test_a_failure_is_not_an_empty_list(self, _run):
        # « Aucune base » ferait oublier toutes les échéances du projet.
        self.assertIsNone(web.database_oids_for("CLIENT", check_container=False))

    @patch("odoo_manager_web.container_status", return_value="exited")
    def test_a_stopped_postgresql_is_not_queried(self, _status):
        self.assertIsNone(web.database_oids_for("CLIENT"))


class ArrivalTests(RetentionTestCase):
    @patch("odoo_manager_web.database_oids_for", return_value={"prod": 16384})
    def test_a_restored_database_is_recorded_with_its_deadline(self, _oids):
        job = LogJob()
        web.remember_database_arrival(job, "CLIENT", "prod", "restored")
        record = self.state("CLIENT")["databases"]["prod"]
        self.assertEqual(("restored", 16384), (record["origin"], record["oid"]))
        self.assertTrue(any("supprimée automatiquement" in line for line in job.lines))

    @patch("odoo_manager_web.database_oids_for", side_effect=RuntimeError("Docker ne répond pas"))
    def test_a_bookkeeping_failure_does_not_fail_the_restore(self, _oids):
        job = LogJob()
        web.remember_database_arrival(job, "CLIENT", "prod", "restored")
        self.assertEqual({}, self.state("CLIENT")["databases"])
        self.assertTrue(any("non enregistrée" in line for line in job.lines))


@patch("odoo_manager_web.Job", RecordedJob)
@patch("odoo_manager_web.docker_available", return_value=(True, ""))
class ScheduleTests(RetentionTestCase):
    def setUp(self):
        super().setUp()
        RecordedJob.created = []
        for project in ("RUNNING", "STOPPED"):
            (self.workspace / project).mkdir()
        statuses = patch(
            "odoo_manager_web.container_statuses",
            return_value={"postgresql-RUNNING": "running", "postgresql-STOPPED": "exited"},
        )
        statuses.start()
        self.addCleanup(statuses.stop)
        projects = patch("odoo_manager_web.project_dirs", return_value=["RUNNING", "STOPPED"])
        projects.start()
        self.addCleanup(projects.stop)

    def titles(self):
        return sorted(job.title for job in RecordedJob.created)

    @patch("odoo_manager_web.database_oids_for", return_value={"postgres": 5, "prod": 16384})
    def test_running_projects_are_read_and_stopped_ones_inventoried_once(self, oids, _docker):
        web.schedule_database_retention()

        oids.assert_called_once_with("RUNNING", check_container=False)
        self.assertEqual(["prod"], list(self.state("RUNNING")["databases"]))
        # Projet arrêté jamais relevé : une action démarre ses conteneurs le temps du relevé.
        self.assertEqual(["Relever les bases de STOPPED"], self.titles())
        job = RecordedJob.created[0]
        self.assertIs(job.target, web.database_retention_job)
        self.assertEqual({"project:STOPPED", web.RETENTION_RESOURCE}, set(job.resources))

    @patch("odoo_manager_web.database_oids_for", return_value={"prod": 16384})
    def test_an_expired_database_gets_a_deletion_job(self, _oids, _docker):
        web.schedule_database_retention()
        RecordedJob.created = []
        web.schedule_database_retention(now=time.time() + RETENTION_SECONDS + 60)
        self.assertIn("Supprimer les bases arrivées à échéance dans RUNNING", self.titles())

    @patch("odoo_manager_web.database_oids_for", return_value={})
    def test_a_project_that_failed_recently_is_left_alone(self, _oids, _docker):
        web.RETENTION_FAILURES["STOPPED"] = time.monotonic()
        web.schedule_database_retention()
        self.assertEqual([], self.titles())

    @patch("odoo_manager_web.database_oids_for", return_value={})
    def test_old_trash_entries_are_purged(self, _oids, _docker):
        trash = self.workspace / ".odoo_manager_deleted"
        (trash / "20200101_100000_OLD").mkdir(parents=True)
        (trash / f"{time.strftime('%Y%m%d_%H%M%S')}_RECENT").mkdir()
        self.store.reconcile(str(self.workspace), "STOPPED", {})

        web.schedule_database_retention()

        purge = [job for job in RecordedJob.created if job.target is web.purge_deleted_projects_job]
        self.assertEqual([(["20200101_100000_OLD"],)], [job.args for job in purge])

    def test_nothing_happens_without_docker(self, docker):
        docker.return_value = (False, "Docker arrêté")
        self.assertEqual([], web.schedule_database_retention())


class RetentionJobTests(RetentionTestCase):
    def setUp(self):
        super().setUp()
        self.service = MagicMock()
        service = patch("odoo_manager_web.project_service", return_value=self.service)
        service.start()
        self.addCleanup(service.stop)
        for name in ("invalidate_overview_databases", "clear_project_module_cache"):
            patcher = patch(f"odoo_manager_web.{name}")
            patcher.start()
            self.addCleanup(patcher.stop)
        validate = patch("odoo_manager_web.validate_project", side_effect=lambda name: name)
        validate.start()
        self.addCleanup(validate.stop)
        (self.workspace / "CLIENT").mkdir()
        self.store.record_arrival(str(self.workspace), "CLIENT", "old", 16384, "restored")
        self.store.record_arrival(str(self.workspace), "CLIENT", "empty", 16385, "created")
        self.store._payload["workspaces"][str(self.workspace)]["CLIENT"]["databases"]["old"]["expires_at"] = 0

    @patch("odoo_manager_web.drop_partial_database")
    @patch("odoo_manager_web.database_oids_for", return_value={"old": 16384, "empty": 16385})
    @patch("odoo_manager_web.container_status", return_value="exited")
    def test_a_stopped_project_is_started_cleaned_then_stopped_again(self, status, _oids, drop):
        # PostgreSQL démarre pendant le contrôle.
        status.side_effect = lambda name: "running" if self.service.compose_up_project.called else "exited"
        job = LogJob()

        web.database_retention_job(job, "CLIENT")

        self.service.compose_up_project.assert_called_once()
        self.service.start_odoo_server.assert_not_called()
        drop.assert_called_once_with(job, "CLIENT", "old")
        self.service.stop_project.assert_called_once()
        self.assertEqual(["empty"], list(self.state("CLIENT")["databases"]))
        self.assertEqual({"kind": "database_retention", "deleted": ["old"]}, job.result)

    @patch("odoo_manager_web.drop_partial_database")
    @patch("odoo_manager_web.database_oids_for", return_value={"old": 16384, "empty": 16385})
    @patch("odoo_manager_web.container_status", return_value="running")
    def test_a_running_project_stays_running(self, _status, _oids, drop):
        web.database_retention_job(LogJob(), "CLIENT")
        self.service.compose_up_project.assert_not_called()
        self.service.stop_project.assert_not_called()
        drop.assert_called_once()

    @patch("odoo_manager_web.drop_partial_database")
    @patch("odoo_manager_web.database_oids_for", return_value={"old": 16384})
    @patch("odoo_manager_web.container_status", return_value="running")
    def test_a_filestore_left_behind_fails_the_job_and_keeps_the_record(self, _status, _oids, _drop):
        (self.workspace / "CLIENT" / "odoo_data" / "filestore" / "old").mkdir(parents=True)
        with self.assertRaises(RuntimeError):
            web.database_retention_job(LogJob(), "CLIENT")
        self.assertIn("old", self.state("CLIENT")["databases"])
        self.assertIn("CLIENT", web.RETENTION_FAILURES)

    @patch("odoo_manager_web.job_control.sleep")
    @patch("odoo_manager_web.database_oids_for", return_value=None)
    @patch("odoo_manager_web.container_status", return_value="exited")
    def test_containers_started_for_the_check_are_stopped_even_on_failure(self, _status, oids, _sleep):
        with self.assertRaises(RuntimeError):
            web.database_retention_job(LogJob(), "CLIENT")
        self.assertEqual(web.RETENTION_LIST_ATTEMPTS, oids.call_count)
        self.service.stop_project.assert_called_once()

    @patch("odoo_manager_web.drop_partial_database")
    @patch("odoo_manager_web.job_control.sleep")
    @patch("odoo_manager_web.database_oids_for", side_effect=[None, None, {"old": 16384}])
    @patch("odoo_manager_web.container_status", return_value="running")
    def test_postgresql_gets_a_few_seconds_to_accept_connections(self, _status, _oids, _sleep, drop):
        web.database_retention_job(LogJob(), "CLIENT")
        drop.assert_called_once()


class ExtendViewTests(RetentionTestCase):
    @patch("odoo_manager_web.EVENT_WAKE")
    def test_the_deadline_is_pushed_back_on_request(self, _wake):
        self.store.record_arrival(str(self.workspace), "CLIENT", "prod", 16384, "restored")
        before = self.state("CLIENT")["databases"]["prod"]["expires_at"]
        request = MagicMock()
        request.param.return_value = "CLIENT"
        request.handler.read_json.return_value = {"db": "prod"}
        with patch("odoo_manager_web.validate_project", side_effect=lambda name: name):
            payload = web.extend_database_retention_view(request)
        self.assertEqual(before + RETENTION_SECONDS, payload["expires_at"])


if __name__ == "__main__":
    unittest.main()
