"""Écoute des événements des conteneurs Docker (`docker events`).

La boucle d'état relisait tous les conteneurs toutes les 2 s, même quand rien ne bougeait.
Abonnée à ce flux, elle se réveille dès qu'un conteneur est créé, démarre, s'arrête ou
disparaît, et ne relit plus qu'à un rythme lent, en filet de sécurité.

Le flux passe par la CLI plutôt que par l'API du moteur : il suit ainsi le même moteur que
les actions, y compris dans WSL ou avec un exécutable Docker personnalisé. Quand Docker
s'arrête, la commande se termine ; elle est relancée avec un délai croissant.
"""

import subprocess
import threading
import time

CONTAINER_EVENTS = ("create", "start", "die", "destroy", "pause", "unpause", "rename")
# Délais avant de relancer une écoute qui vient de s'arrêter : Docker arrêté, redémarrage…
RETRY_DELAYS_SECONDS = (1, 2, 5, 10, 30)
# Une écoute vivante depuis ce délai est branchée : un Docker arrêté la fait échouer aussitôt.
CONNECTED_AFTER_SECONDS = 2


def docker_events_arguments():
    """Arguments de `docker events` : une ligne courte par événement de conteneur utile."""
    arguments = ["events", "--format", "{{.Type}} {{.Action}} {{.Actor.Attributes.name}}"]
    arguments += ["--filter", "type=container"]
    for event in CONTAINER_EVENTS:
        arguments += ["--filter", f"event={event}"]
    return arguments


class DockerEventWatcher:
    """Garde un `docker events` ouvert et appelle `on_change` à chaque événement ou coupure.

    `command_factory` rend (commande, options de Popen) ; elle est rappelée à chaque relance,
    pour suivre un changement de réglages (moteur, exécutable, distribution WSL).
    """

    def __init__(self, command_factory, on_change, popen=subprocess.Popen, clock=time.monotonic):
        self.command_factory = command_factory
        self.on_change = on_change
        self.popen = popen
        self.clock = clock
        self._lock = threading.Lock()
        self._process = None
        self._started_at = 0.0
        self._thread = None
        self._stopping = threading.Event()
        # Interrompt l'attente avant une relance : arrêt du service ou réglages modifiés.
        self._interrupt = threading.Event()

    @property
    def connected(self):
        with self._lock:
            process, started_at = self._process, self._started_at
        return process is not None and process.poll() is None and self.clock() - started_at >= CONNECTED_AFTER_SECONDS

    def start(self):
        with self._lock:
            if self._thread is not None:
                return
            self._thread = threading.Thread(target=self._run, name="docker-events", daemon=True)
        self._thread.start()

    def restart(self):
        """Relance l'écoute avec la commande du moment (réglages Docker modifiés)."""
        self._interrupt.set()
        self._terminate()

    def stop(self):
        self._stopping.set()
        self._interrupt.set()
        self._terminate()

    def _terminate(self):
        with self._lock:
            process = self._process
        if process is not None and process.poll() is None:
            try:
                process.kill()
            except OSError:
                pass

    def _listen(self):
        """Lit le flux jusqu'à sa fin ; True si l'écoute a tenu assez longtemps pour compter."""
        started = self.clock()
        try:
            command, options = self.command_factory()
            process = self.popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                **options,
            )
        except (OSError, RuntimeError, ValueError):
            return False
        with self._lock:
            self._process, self._started_at = process, started
        try:
            for line in process.stdout:
                if line.strip():
                    self.on_change(line.strip())
        except (OSError, ValueError):
            pass
        finally:
            try:
                process.kill()
            except OSError:
                pass
            process.wait()
            with self._lock:
                self._process = None
        # Docker arrêté ou redémarré : l'état des conteneurs a pu changer.
        self.on_change("")
        return self.clock() - started >= CONNECTED_AFTER_SECONDS

    def _run(self):
        failures = 0
        while not self._stopping.is_set():
            failures = 0 if self._listen() else failures + 1
            if self._stopping.is_set():
                return
            if self._interrupt.is_set():
                self._interrupt.clear()
                failures = 0
                continue
            delay = RETRY_DELAYS_SECONDS[min(max(failures - 1, 0), len(RETRY_DELAYS_SECONDS) - 1)]
            if self._interrupt.wait(delay):
                self._interrupt.clear()
                failures = 0
