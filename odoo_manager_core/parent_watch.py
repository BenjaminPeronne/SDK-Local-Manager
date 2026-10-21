"""Le backend s'arrête avec l'application qui l'a lancé.

Une application qui plante, qu'on force à quitter ou dont le processus est tué ne prévient pas
son backend : il restait démarré des heures, gardait le port de l'API, et la session suivante
devait se rabattre sur un port au hasard.

Deux signaux indépendants, chacun suffit :

- `ODOO_MANAGER_PARENT_PID` : le processus de l'application, surveillé tant qu'il existe ;
- `ODOO_MANAGER_WATCH_STDIN=1` : l'entrée standard est un tube que l'application garde ouvert
  sans jamais y écrire. Le système le ferme à la disparition de l'application, quelle qu'en soit
  la cause : le backend lit alors une fin de fichier. C'est le seul signal qui traverse
  `wsl.exe`, le numéro de processus Windows n'ayant aucun sens dans Linux.

Sans ces variables (backend lancé à la main en développement), rien n'est surveillé.
"""

import os
import threading
import time

PARENT_PID_VARIABLE = "ODOO_MANAGER_PARENT_PID"
WATCH_STDIN_VARIABLE = "ODOO_MANAGER_WATCH_STDIN"
# Délai entre deux vérifications du processus de l'application, hors Windows.
POLL_SECONDS = 2.0

# Windows : droits demandés sur le processus de l'application, et code d'un processus vivant.
_SYNCHRONIZE = 0x00100000
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259
_ERROR_INVALID_PARAMETER = 87
_INFINITE = 0xFFFFFFFF


def parent_pid(environ):
    """Processus de l'application à surveiller, ou None s'il n'y en a pas."""
    try:
        pid = int(environ.get(PARENT_PID_VARIABLE, "").strip())
    except ValueError:
        return None
    return pid if pid > 0 else None


def _kernel32():
    import ctypes

    return ctypes, ctypes.WinDLL("kernel32", use_last_error=True)


def process_alive(pid):
    """Le processus existe-t-il encore ? Un processus d'un autre compte compte comme vivant."""
    if os.name == "nt":
        ctypes, kernel32 = _kernel32()
        handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return ctypes.get_last_error() != _ERROR_INVALID_PARAMETER
        try:
            code = ctypes.c_ulong()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == _STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _wait_windows_process(pid):
    """Attend la fin du processus sans sonder. False si Windows refuse de l'ouvrir."""
    ctypes, kernel32 = _kernel32()
    handle = kernel32.OpenProcess(_SYNCHRONIZE, False, pid)
    if not handle:
        # Déjà terminé : rien à attendre. Autre refus : la vérification périodique prend le relais.
        return ctypes.get_last_error() == _ERROR_INVALID_PARAMETER
    try:
        # Le descripteur ouvert désigne ce processus-là : un numéro repris ensuite ne trompe pas l'attente.
        kernel32.WaitForSingleObject(handle, _INFINITE)
    finally:
        kernel32.CloseHandle(handle)
    return True


def wait_for_parent_exit(pid, *, alive=process_alive, getppid=os.getppid, sleep=time.sleep, poll=POLL_SECONDS):
    """Rend la main quand le processus de l'application a disparu."""
    if os.name == "nt" and alive is process_alive and _wait_windows_process(pid):
        return
    # Enfant direct de l'application : rattaché à un autre parent (init, launchd) dès qu'elle
    # disparaît, même si son numéro est déjà repris par un autre processus.
    direct_child = os.name != "nt" and getppid() == pid
    while alive(pid):
        if direct_child and getppid() != pid:
            return
        sleep(poll)


def detach_stdin(*, devnull=os.devnull):
    """Met le tube de l'application de côté, et rend à l'entrée standard sa valeur habituelle.

    Les commandes lancées par le backend (git, docker, Odoo) héritent de l'entrée standard :
    restée sur le tube, une commande qui la lirait attendrait la fermeture de l'application.
    Elles reçoivent donc un fichier vide, comme avant. None si l'entrée standard est inutilisable.
    """
    try:
        # Descripteur non hérité par les commandes lancées ensuite (PEP 446).
        watched = os.dup(0)
    except OSError:
        return None
    empty = os.open(devnull, os.O_RDONLY)
    try:
        os.dup2(empty, 0)
    finally:
        os.close(empty)
    return watched


def wait_for_eof(fd, *, read=os.read):
    """Rend la main à la fermeture du tube : fin de fichier, ou tube rompu sous Windows."""
    try:
        while read(fd, 4096):
            # L'application n'écrit rien : des octets reçus ne changent rien à l'attente.
            pass
    except OSError:
        pass
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


def watch_parent(on_exit, environ=None):
    """Lance la surveillance demandée par l'environnement ; `on_exit(motif)` est appelé une fois.

    Rend les fils de surveillance lancés (aucun quand rien n'est demandé).
    """
    env = os.environ if environ is None else environ
    called = threading.Lock()

    def notify(reason):
        if called.acquire(blocking=False):
            on_exit(reason)

    threads = []
    pid = parent_pid(env)
    if pid:

        def watch_process():
            wait_for_parent_exit(pid)
            notify(f"L'application (processus {pid}) s'est arrêtée.")

        threads.append(threading.Thread(target=watch_process, name="parent-process-watch", daemon=True))
    if env.get(WATCH_STDIN_VARIABLE) == "1":
        fd = detach_stdin()
        if fd is not None:

            def watch_stdin():
                wait_for_eof(fd)
                notify("L'application a fermé le lien avec le backend.")

            threads.append(threading.Thread(target=watch_stdin, name="parent-stdin-watch", daemon=True))
    for thread in threads:
        thread.start()
    return threads
