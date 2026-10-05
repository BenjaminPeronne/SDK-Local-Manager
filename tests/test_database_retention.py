import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from odoo_manager_core.database_retention import (
    DAY_SECONDS,
    RETENTION_SECONDS,
    RetentionStore,
    expired_databases,
    expired_trash_entries,
    needs_inventory,
    retention_summary,
)

WORKSPACE = "/home/dev/Odoo-projects"


class Clock:
    def __init__(self, now=1_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


class RetentionStoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "database_retention.json"
        self.clock = Clock()
        self.store = RetentionStore(self.path, clock=self.clock)

    def state(self, project="CLIENT"):
        return self.store.project_state(WORKSPACE, project)

    def test_a_restored_database_expires_thirty_days_after_its_arrival(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "prod", 101, "restored")
        record = self.state()["databases"]["prod"]
        self.assertEqual(record["expires_at"], self.clock.now + RETENTION_SECONDS)
        self.assertEqual([], expired_databases(self.state(), self.clock.now + RETENTION_SECONDS - 1))
        self.assertEqual(["prod"], expired_databases(self.state(), self.clock.now + RETENTION_SECONDS))

    def test_an_empty_database_created_here_is_kept(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "test", 102, "created")
        self.assertIsNone(self.state()["databases"]["test"]["expires_at"])
        self.assertEqual([], expired_databases(self.state(), self.clock.now + 10 * RETENTION_SECONDS))

    def test_a_copy_keeps_the_deadline_of_its_original(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "prod", 101, "restored")
        deadline = self.state()["databases"]["prod"]["expires_at"]
        self.clock.now += 10 * DAY_SECONDS
        # Dupliquer ne remet pas le compteur à zéro : sinon la règle se contourne en un clic.
        self.store.record_arrival(WORKSPACE, "CLIENT", "prod_copy", 103, "duplicated", source="prod")
        self.assertEqual(deadline, self.state()["databases"]["prod_copy"]["expires_at"])
        # Copie d'une base vide créée ici : conservée elle aussi.
        self.store.record_arrival(WORKSPACE, "CLIENT", "test", 102, "created")
        self.store.record_arrival(WORKSPACE, "CLIENT", "test_copy", 104, "duplicated", source="test")
        self.assertIsNone(self.state()["databases"]["test_copy"]["expires_at"])

    def test_reconcile_starts_the_clock_for_unknown_databases_and_forgets_dropped_ones(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "prod", 101, "restored")
        self.store.record_arrival(WORKSPACE, "CLIENT", "old", 99, "restored")
        self.clock.now += DAY_SECONDS
        state = self.store.reconcile(WORKSPACE, "CLIENT", {"prod": 101, "manual": 105, "postgres": 5})

        self.assertEqual({"prod", "manual"}, set(state["databases"]))
        self.assertEqual("restored", state["databases"]["prod"]["origin"])
        self.assertEqual("detected", state["databases"]["manual"]["origin"])
        self.assertEqual(self.clock.now + RETENTION_SECONDS, state["databases"]["manual"]["expires_at"])
        self.assertEqual(self.clock.now, state["inventoried_at"])

    def test_a_database_recreated_under_the_same_name_is_a_new_database(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "test", 102, "created")
        self.clock.now += DAY_SECONDS
        state = self.store.reconcile(WORKSPACE, "CLIENT", {"test": 120})
        self.assertEqual("detected", state["databases"]["test"]["origin"])
        self.assertEqual(self.clock.now + RETENTION_SECONDS, state["databases"]["test"]["expires_at"])

    def test_the_deadline_can_be_pushed_back_as_often_as_needed(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "prod", 101, "restored")
        first = self.state()["databases"]["prod"]["expires_at"]
        self.assertEqual(first + RETENTION_SECONDS, self.store.extend(WORKSPACE, "CLIENT", "prod"))
        self.assertEqual(first + 2 * RETENTION_SECONDS, self.store.extend(WORKSPACE, "CLIENT", "prod"))
        # Échéance déjà passée (gestionnaire fermé) : les 30 jours partent de maintenant.
        self.clock.now = first + 5 * RETENTION_SECONDS
        self.assertEqual(self.clock.now + RETENTION_SECONDS, self.store.extend(WORKSPACE, "CLIENT", "prod"))

    def test_only_databases_with_a_deadline_can_be_extended(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "test", 102, "created")
        with self.assertRaises(ValueError):
            self.store.extend(WORKSPACE, "CLIENT", "test")
        with self.assertRaises(ValueError):
            self.store.extend(WORKSPACE, "CLIENT", "absent")

    def test_the_register_survives_a_restart(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "prod", 101, "restored")
        reloaded = RetentionStore(self.path, clock=self.clock)
        self.assertEqual(self.state(), reloaded.project_state(WORKSPACE, "CLIENT"))
        self.assertEqual(1, json.loads(self.path.read_text(encoding="utf-8"))["version"])

    def test_an_unreadable_register_starts_empty(self):
        self.path.write_text("{pas du json", encoding="utf-8")
        store = RetentionStore(self.path, clock=self.clock)
        self.assertEqual({"inventoried_at": None, "databases": {}}, store.project_state(WORKSPACE, "CLIENT"))

    def test_projects_gone_from_the_workspace_and_the_trash_are_forgotten(self):
        for project in ("CLIENT", "TRASHED", "GONE"):
            self.store.record_arrival(WORKSPACE, project, "prod", 101, "restored")
        self.store.prune_projects(WORKSPACE, {"CLIENT", "TRASHED"})
        self.assertTrue(self.state("TRASHED")["databases"])
        self.assertEqual({}, self.state("GONE")["databases"])

    def test_forget_removes_one_database(self):
        self.store.record_arrival(WORKSPACE, "CLIENT", "prod", 101, "restored")
        self.store.forget(WORKSPACE, "CLIENT", "prod")
        self.assertEqual({}, self.state()["databases"])


class RetentionDecisionTests(unittest.TestCase):
    def test_a_project_is_inventoried_when_never_read_or_read_long_ago(self):
        now = 1_000_000.0
        self.assertTrue(needs_inventory({"inventoried_at": None, "databases": {}}, now))
        self.assertFalse(needs_inventory({"inventoried_at": now - DAY_SECONDS, "databases": {}}, now))
        self.assertTrue(needs_inventory({"inventoried_at": now - RETENTION_SECONDS, "databases": {}}, now))

    def test_the_summary_gives_each_deadline(self):
        state = {"databases": {"prod": {"oid": 1, "origin": "restored", "arrived_at": 0, "expires_at": 9}}}
        self.assertEqual({"prod": {"expires_at": 9, "origin": "restored"}}, retention_summary(state))

    def test_trash_entries_are_due_thirty_days_after_deletion(self):
        deleted = datetime(2026, 9, 1, 10, 30).timestamp()
        entries = [
            {"name": "20260901_103000_CLIENT", "project": "CLIENT", "deleted_at": "2026-09-01 10:30"},
            {"name": "inconnu", "project": "X", "deleted_at": "illisible"},
        ]
        self.assertEqual([], expired_trash_entries(entries, deleted + RETENTION_SECONDS - 60))
        self.assertEqual([entries[0]], expired_trash_entries(entries, deleted + RETENTION_SECONDS))


if __name__ == "__main__":
    unittest.main()
