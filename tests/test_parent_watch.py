import os
import signal
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from pathlib import Path

from odoo_manager_core import parent_watch
from odoo_manager_core.parent_watch import (
    detach_stdin,
    parent_pid,
    process_alive,
    wait_for_eof,
    wait_for_parent_exit,
    watch_parent,
)

ROOT = Path(__file__).resolve().parents[1]


def wait_until(condition, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.05)
    return condition()


class ParentPidTests(unittest.TestCase):
    def test_only_a_positive_number_is_watched(self):
        self.assertEqual(parent_pid({"ODOO_MANAGER_PARENT_PID": " 4242 "}), 4242)
        for value in ("", "abc", "0", "-3"):
            self.assertIsNone(parent_pid({"ODOO_MANAGER_PARENT_PID": value}))
        self.assertIsNone(parent_pid({}))

    def test_current_process_is_alive_and_a_finished_one_is_not(self):
        self.assertTrue(process_alive(os.getpid()))
        child = subprocess.Popen([sys.executable, "-c", "pass"])
        child.wait()
        self.assertFalse(process_alive(child.pid))


class WaitForParentTests(unittest.TestCase):
    def test_returns_once_the_application_is_gone(self):
        states = iter([True, True, False])
        sleeps = []

        wait_for_parent_exit(4242, alive=lambda _pid: next(states), getppid=lambda: 1, sleep=sleeps.append, poll=2.0)

        self.assertEqual(sleeps, [2.0, 2.0])

    @unittest.skipIf(os.name == "nt", "Windows ne rattache pas les processus orphelins")
    def test_a_reparented_child_stops_even_if_its_parent_number_is_reused(self):
        # Le numéro de l'application est repris par un autre processus : il paraît vivant, mais
        # le backend a changé de parent, ce qui suffit.
        parents = iter([4242, 4242, 1])
        sleeps = []

        wait_for_parent_exit(4242, alive=lambda _pid: True, getppid=lambda: next(parents), sleep=sleeps.append)

        self.assertEqual(len(sleeps), 1)


class StdinWatchTests(unittest.TestCase):
    def test_end_of_file_and_broken_pipe_both_end_the_wait(self):
        for chunks in ([b"x", b""], [BrokenPipeError()]):
            read_fd, write_fd = os.pipe()
            os.close(write_fd)
            pending = list(chunks)

            def read(_fd, _size, pending=pending):
                value = pending.pop(0)
                if isinstance(value, Exception):
                    raise value
                return value

            wait_for_eof(read_fd, read=read)
            self.assertEqual(pending, [])
            with self.assertRaises(OSError):
                os.fstat(read_fd)

    def test_commands_started_later_get_an_empty_input_instead_of_the_pipe(self):
        read_fd, write_fd = os.pipe()
        saved = os.dup(0)
        try:
            os.dup2(read_fd, 0)
            os.close(read_fd)
            watched = detach_stdin()
            try:
                self.assertIsNotNone(watched)
                self.assertFalse(os.get_inheritable(watched))
                # Une commande qui lit son entrée ne doit pas attendre la fermeture de l'application.
                result = subprocess.run(
                    [sys.executable, "-c", "import sys; print(repr(sys.stdin.read()))"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                self.assertEqual(result.stdout.strip(), "''")
                os.write(write_fd, b"ignored")
                os.close(write_fd)
                write_fd = None
                wait_for_eof(watched)
            finally:
                if write_fd is not None:
                    os.close(write_fd)
        finally:
            os.dup2(saved, 0)
            os.close(saved)


class WatchParentTests(unittest.TestCase):
    def test_nothing_is_watched_without_the_variables(self):
        self.assertEqual(watch_parent(lambda _reason: None, {}), [])

    def test_the_callback_runs_once_even_when_both_signals_fire(self):
        reasons = []
        done = threading.Event()

        def on_exit(reason):
            reasons.append(reason)
            done.set()

        read_fd, write_fd = os.pipe()
        original_detach = parent_watch.detach_stdin
        original_wait = parent_watch.wait_for_parent_exit
        parent_watch.detach_stdin = lambda: read_fd
        parent_watch.wait_for_parent_exit = lambda _pid: None
        try:
            threads = watch_parent(on_exit, {"ODOO_MANAGER_PARENT_PID": "4242", "ODOO_MANAGER_WATCH_STDIN": "1"})
            os.close(write_fd)
            for thread in threads:
                thread.join(5)
        finally:
            parent_watch.detach_stdin = original_detach
            parent_watch.wait_for_parent_exit = original_wait

        self.assertTrue(done.is_set())
        self.assertEqual(len(threads), 2)
        self.assertEqual(len(reasons), 1)


class OrphanedProcessTests(unittest.TestCase):
    """Cas vécu : l'application tuée, son backend restait des heures sur le port de l'API."""

    def run_orphan(self, environment_for):
        with tempfile.TemporaryDirectory() as temporary:
            report = Path(temporary) / "backend.pid"
            # Le « backend » : surveille son application comme odoo_manager_web.main, et dort.
            backend = textwrap.dedent(
                f"""
                import os, sys, threading
                sys.path.insert(0, {str(ROOT)!r})
                from odoo_manager_core.parent_watch import watch_parent
                stopped = threading.Event()
                watch_parent(lambda reason: stopped.set())
                open({str(report)!r}, "w").write(str(os.getpid()))
                stopped.wait(60)
                """
            )
            # L'« application » : lance le backend avec un tube ouvert sur son entrée, puis attend.
            application = textwrap.dedent(
                f"""
                import os, subprocess, sys, time
                env = dict(os.environ, **{{key: value.replace("SELF", str(os.getpid())) for key, value in {environment_for!r}.items()}})
                subprocess.Popen([sys.executable, "-c", {backend!r}], stdin=subprocess.PIPE, env=env)
                time.sleep(60)
                """
            )
            app = subprocess.Popen([sys.executable, "-c", application])
            try:
                self.assertTrue(wait_until(report.exists), "le backend n'a pas démarré")
                self.assertTrue(wait_until(lambda: report.read_text().strip() != ""))
                backend_pid = int(report.read_text())

                # Arrêt brutal : aucun code de l'application ne s'exécute.
                app.kill()
                app.wait(10)

                stopped = wait_until(lambda: not process_alive(backend_pid))
                if not stopped:
                    os.kill(backend_pid, signal.SIGKILL if hasattr(signal, "SIGKILL") else signal.SIGTERM)
                self.assertTrue(stopped, "le backend a survécu à son application")
            finally:
                if app.poll() is None:
                    app.kill()
                    app.wait(10)

    def test_backend_stops_when_its_input_pipe_closes(self):
        self.run_orphan({"ODOO_MANAGER_WATCH_STDIN": "1"})

    def test_backend_stops_when_the_application_process_disappears(self):
        self.run_orphan({"ODOO_MANAGER_PARENT_PID": "SELF"})


if __name__ == "__main__":
    unittest.main()
