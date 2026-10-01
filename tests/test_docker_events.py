import threading
import time
import unittest
from unittest import mock

from odoo_manager_core import docker_events
from odoo_manager_core.docker_events import DockerEventWatcher, docker_events_arguments


class FakeProcess:
    """`docker events` simulé : rend les lignes données, puis reste ouvert si `blocking`."""

    def __init__(self, lines, blocking=False):
        self.stdout = self._stream(lines)
        self.blocking = blocking
        self.returncode = None
        self.closed = threading.Event()
        if not blocking:
            self.closed.set()

    def _stream(self, lines):
        yield from lines
        self.closed.wait(5)

    def poll(self):
        return None if not self.closed.is_set() else 0

    def kill(self):
        self.closed.set()

    def wait(self):
        self.closed.wait(5)
        return 0


def wait_until(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


class DockerEventsArgumentsTests(unittest.TestCase):
    def test_listens_only_to_container_events_that_change_their_state(self):
        arguments = docker_events_arguments()
        self.assertEqual("events", arguments[0])
        self.assertIn("type=container", arguments)
        self.assertIn("event=start", arguments)
        self.assertIn("event=die", arguments)
        self.assertNotIn("event=exec_start", arguments)


class DockerEventWatcherTests(unittest.TestCase):
    def setUp(self):
        self.changes = []
        self.processes = []
        self.commands = 0

    def factory(self):
        self.commands += 1
        return ["docker", "events"], {"cwd": "/"}

    def watcher(self, popen):
        return DockerEventWatcher(self.factory, self.changes.append, popen=popen)

    def test_each_event_line_wakes_the_listener_and_the_stream_stays_connected(self):
        process = FakeProcess(["container start odoo-demo\n", "\n", "container die odoo-demo\n"], blocking=True)
        watcher = self.watcher(lambda *_args, **_kwargs: process)
        with mock.patch.object(docker_events, "CONNECTED_AFTER_SECONDS", 0):
            watcher.start()
            self.assertTrue(wait_until(lambda: len(self.changes) == 2))
            self.assertEqual(["container start odoo-demo", "container die odoo-demo"], self.changes)
            self.assertTrue(watcher.connected)
            watcher.stop()
            self.assertTrue(wait_until(lambda: not watcher.connected))

    def test_a_stopped_docker_reports_the_cut_and_retries_with_a_growing_delay(self):
        popen = mock.Mock(side_effect=lambda *_args, **_kwargs: FakeProcess([]))
        watcher = self.watcher(popen)
        delays = []
        real_wait = watcher._interrupt.wait

        def record_wait(delay):
            delays.append(delay)
            if len(delays) >= 3:
                watcher._stopping.set()
                return True
            return real_wait(0)

        with mock.patch.object(watcher._interrupt, "wait", side_effect=record_wait):
            watcher.start()
            self.assertTrue(wait_until(lambda: watcher._thread and not watcher._thread.is_alive()))
        self.assertEqual([1, 2, 5], delays)
        self.assertIn("", self.changes)
        self.assertFalse(watcher.connected)

    def test_restart_rebuilds_the_command_for_new_settings(self):
        processes = [FakeProcess([], blocking=True), FakeProcess([], blocking=True)]
        watcher = self.watcher(lambda *_args, **_kwargs: processes.pop(0))
        watcher.start()
        self.assertTrue(wait_until(lambda: self.commands == 1 and watcher._process is not None))
        watcher.restart()
        self.assertTrue(wait_until(lambda: self.commands == 2))
        watcher.stop()

    def test_a_missing_docker_executable_never_stops_the_watcher(self):
        def popen(*_args, **_kwargs):
            raise FileNotFoundError("docker")

        watcher = self.watcher(popen)
        with mock.patch.object(watcher._interrupt, "wait", side_effect=lambda _delay: watcher._stopping.set() or True):
            watcher.start()
            self.assertTrue(wait_until(lambda: not watcher._thread.is_alive()))
        self.assertFalse(watcher.connected)
        self.assertEqual(1, self.commands)


if __name__ == "__main__":
    unittest.main()
