import tempfile
import unittest
from pathlib import Path

from odoo_manager_core.ssh_hosts import GITLAB_HOST_KEYS, ensure_pinned_host_keys

ROOT = Path(__file__).resolve().parents[1]


class PinnedHostKeysTests(unittest.TestCase):
    def test_creates_known_hosts_when_absent(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(len(GITLAB_HOST_KEYS), ensure_pinned_host_keys(home))
            lines = (Path(home) / ".ssh" / "known_hosts").read_text(encoding="utf-8").splitlines()
        self.assertEqual(list(GITLAB_HOST_KEYS), lines)

    def test_second_call_adds_nothing(self):
        with tempfile.TemporaryDirectory() as home:
            ensure_pinned_host_keys(home)
            self.assertEqual(0, ensure_pinned_host_keys(home))
            lines = (Path(home) / ".ssh" / "known_hosts").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(GITLAB_HOST_KEYS), len(lines))

    def test_hashed_entries_count_as_present_and_other_hosts_are_kept(self):
        with tempfile.TemporaryDirectory() as home:
            ssh_dir = Path(home) / ".ssh"
            ssh_dir.mkdir()
            ed25519_key = GITLAB_HOST_KEYS[0].split(" ", 1)[1]
            existing = f"|1|c2FsdA==|aGFzaA== {ed25519_key}\ngithub.com ssh-ed25519 AAAAother"
            (ssh_dir / "known_hosts").write_text(existing, encoding="utf-8")
            self.assertEqual(len(GITLAB_HOST_KEYS) - 1, ensure_pinned_host_keys(home))
            content = (ssh_dir / "known_hosts").read_text(encoding="utf-8")
        self.assertTrue(content.startswith(existing + "\n"))
        self.assertEqual(1, content.count(ed25519_key))

    def test_wsl_image_ships_the_same_keys(self):
        lines = (ROOT / "wsl" / "known_hosts").read_text(encoding="utf-8").splitlines()
        entries = [line for line in lines if line and not line.startswith("#")]
        self.assertEqual(sorted(GITLAB_HOST_KEYS), sorted(entries))


if __name__ == "__main__":
    unittest.main()
