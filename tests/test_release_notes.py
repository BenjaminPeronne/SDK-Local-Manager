import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import odoo_manager_web as web
from odoo_manager_core import release_notes
from odoo_manager_core.releases import version_key
from odoo_manager_core.version import APP_VERSION

SOURCE = Path(release_notes.__file__).read_text(encoding="utf-8")


class ReleaseNotesTests(unittest.TestCase):
    def test_the_current_version_has_its_notes(self):
        # Échoue à chaque montée de version tant que ses nouveautés ne sont pas écrites.
        versions = [version for version, _date, _items in release_notes.RELEASE_NOTES]
        self.assertIn(APP_VERSION, versions, "Ajoute les nouveautés de cette version dans release_notes.py.")

    def test_entries_are_newest_first_dated_and_not_empty(self):
        keys = [version_key(version) for version, _date, _items in release_notes.RELEASE_NOTES]
        self.assertEqual(sorted(keys, reverse=True), keys)
        self.assertEqual(len(set(keys)), len(keys))
        for version, date, items in release_notes.RELEASE_NOTES:
            with self.subTest(version=version):
                self.assertRegex(date, r"^\d{4}-\d{2}-\d{2}$")
                self.assertTrue(items)
                self.assertTrue(all(item.strip() for item in items))

    def test_the_file_reads_back_without_running_it(self):
        self.assertEqual(release_notes.RELEASE_NOTES, release_notes.parse_release_notes(SOURCE))

    def test_unexpected_content_is_refused(self):
        for source in (
            "RELEASE_NOTES = __import__('os').system('true')",
            "RELEASE_NOTES = (('1.0.0', '2026-01-01', 'pas un tuple'),)",
            "def broken(:",
            "OTHER = ()",
        ):
            with self.subTest(source=source):
                self.assertEqual((), release_notes.parse_release_notes(source))

    def test_markdown_lists_the_changes_of_one_version(self):
        notes = (("1.2.0", "2026-01-02", ("Premier.", "Second.")),)
        self.assertEqual("- Premier.\n- Second.", release_notes.release_notes_markdown("1.2.0", notes))
        with self.assertRaises(KeyError):
            release_notes.release_notes_markdown("9.9.9", notes)

    def test_payload_keeps_the_order(self):
        payload = release_notes.release_notes_payload()
        self.assertEqual(release_notes.RELEASE_NOTES[0][0], payload[0]["version"])
        self.assertTrue(re.match(r"^\d+\.\d+\.\d+$", payload[-1]["version"]))


class NotesRouteTests(unittest.TestCase):
    NOTES = (
        ("2.1.0", "2026-03-01", ("Plus récent que la mise à jour.",)),
        ("2.0.0", "2026-02-01", ("Nouveauté de la mise à jour.",)),
        ("1.0.0", "2026-01-01", ("Déjà installé.",)),
    )

    def setUp(self):
        web.REMOTE_NOTES.clear()
        self.addCleanup(web.REMOTE_NOTES.clear)

    def payload(self, update, remote):
        with (
            patch.object(web, "APP_VERSION", "1.0.0"),
            patch.object(web, "RELEASE_NOTES", self.NOTES),
            patch.object(web, "app_update_payload", return_value=update),
            patch.object(web, "remote_release_notes", return_value=remote),
        ):
            return web.app_update_notes_payload()

    def test_installed_notes_stop_at_the_running_version(self):
        payload = self.payload({"update_available": False}, None)
        self.assertEqual(["1.0.0"], [entry["version"] for entry in payload["installed"]])
        self.assertEqual([], payload["upcoming"])
        self.assertEqual("", payload["upcoming_error"])

    def test_the_update_shows_the_versions_it_brings(self):
        update = {"update_available": True, "tag": "app-v2.0.0-build1", "latest": "2.0.0"}
        payload = self.payload(update, self.NOTES)
        self.assertEqual(["2.0.0"], [entry["version"] for entry in payload["upcoming"]])

    def test_unreadable_remote_notes_say_so_without_failing(self):
        update = {"update_available": True, "tag": "app-v2.0.0-build1", "latest": "2.0.0"}
        payload = self.payload(update, None)
        self.assertEqual([], payload["upcoming"])
        self.assertTrue(payload["upcoming_error"])

    def test_remote_notes_are_read_once_from_the_tag_without_running_them(self):
        service = Mock()
        service.git.side_effect = lambda *arguments: ["git", *arguments]
        service.capture.side_effect = [(0, ""), (0, ""), (0, SOURCE)]
        with tempfile.TemporaryDirectory() as folder:
            store = Mock(path=Path(folder) / "config.json")
            with patch.object(web, "SETTINGS_STORE", store), patch.object(web, "project_service", return_value=service):
                first = web.remote_release_notes("app-v0.51.0-build1")
                second = web.remote_release_notes("app-v0.51.0-build1")
        self.assertEqual(release_notes.RELEASE_NOTES, first)
        self.assertIs(first, second)
        self.assertEqual(3, service.capture.call_count)
        fetch = service.capture.call_args_list[1].args[0]
        self.assertIn("--filter=blob:none", fetch)
        self.assertEqual("refs/tags/app-v0.51.0-build1", fetch[-1])

    def test_a_failed_fetch_is_retried_later(self):
        service = Mock()
        service.git.side_effect = lambda *arguments: ["git", *arguments]
        service.capture.return_value = (128, "Permission denied (publickey)")
        with tempfile.TemporaryDirectory() as folder:
            store = Mock(path=Path(folder) / "config.json")
            with patch.object(web, "SETTINGS_STORE", store), patch.object(web, "project_service", return_value=service):
                self.assertIsNone(web.remote_release_notes("app-v9.0.0-build1"))
        self.assertNotIn("app-v9.0.0-build1", web.REMOTE_NOTES)


if __name__ == "__main__":
    unittest.main()
