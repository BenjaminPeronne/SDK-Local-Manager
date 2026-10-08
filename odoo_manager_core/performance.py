"""Ressources de l'ordinateur, part donnée à Docker et réglages PostgreSQL qui en découlent.

Sous macOS et Windows, Docker tourne dans une machine virtuelle dont la mémoire et les processeurs
sont fixés par Docker Desktop (ou WSL) : 2 Go suffisent à peine à Odoo et PostgreSQL, et une grosse
restauration ou une mise à jour complète finit par manquer de mémoire. Sous Linux, Docker utilise
directement toute la machine.

PostgreSQL, lui, démarre avec des réglages prévus pour une très petite machine (128 Mo de cache,
64 Mo pour construire un index, 1 Go de journal entre deux points de contrôle) : sur une base de
plusieurs Go, les index se construisent sur disque et les points de contrôle s'enchaînent
(« checkpoints are occurring too frequently »). Ses réglages sont donc calculés d'après la mémoire
et les processeurs dont dispose Docker.

Fonctions pures, sauf la lecture des ressources de l'ordinateur et du fichier de Docker Desktop.
"""

import ctypes
import json
import os
import platform
import subprocess
from pathlib import Path

MIB = 1024 * 1024
GIB = 1024 * MIB

# Mémoire laissée au système et aux applications (navigateur, éditeur, Docker Desktop lui-même).
HOST_RESERVED_SHARE = 0.35
HOST_RESERVED_MIN = 4 * GIB
DOCKER_MEMORY_MIN = 2 * GIB
# En dessous, Odoo et PostgreSQL d'un seul projet manquent déjà de mémoire.
DOCKER_MEMORY_CRITICAL = 3 * GIB
SWAP_MIN = 2 * GIB
SWAP_MAX = 4 * GIB
DISK_RECOMMENDED = 64 * GIB
# Ressources de l'ordinateur Windows, transmises par l'application au backend qui tourne dans WSL.
HOST_MEMORY_VARIABLE = "ODOO_MANAGER_HOST_MEMORY"
HOST_CPUS_VARIABLE = "ODOO_MANAGER_HOST_CPUS"

DOCKER_DESKTOP_SETTINGS_DIR = Path.home() / "Library" / "Group Containers" / "group.com.docker"
# Docker Desktop 4.35 et suivants lisent settings-store.json ; les versions précédentes, settings.json.
DOCKER_DESKTOP_SETTINGS_FILES = (
    ("settings-store.json", {"cpus": "Cpus", "memory": "MemoryMiB", "swap": "SwapMiB", "disk": "DiskSizeMiB"}),
    ("settings.json", {"cpus": "cpus", "memory": "memoryMiB", "swap": "swapMiB", "disk": "diskSizeMiB"}),
)

# Réglages de PostgreSQL gérés par le gestionnaire : ceux-là seulement sont écrits ou retirés.
POSTGRES_TUNED_SETTINGS = (
    "shared_buffers",
    "effective_cache_size",
    "maintenance_work_mem",
    "work_mem",
    "max_wal_size",
    "min_wal_size",
    "checkpoint_timeout",
    "checkpoint_completion_target",
    "synchronous_commit",
    "random_page_cost",
    "effective_io_concurrency",
    "max_parallel_workers_per_gather",
    "max_parallel_maintenance_workers",
)


def host_resources(system=None):
    """{"memory": octets, "cpus": nombre} de l'ordinateur ; mémoire à 0 si elle n'est pas lisible."""
    system = system or platform.system()
    cpus = os.cpu_count() or 0
    memory = 0
    try:
        if system == "Darwin":
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
                check=False,
            )
            memory = int(result.stdout)
        elif system == "Windows":
            memory = windows_total_memory()
        elif running_in_wsl():
            # Backend dans WSL : /proc/meminfo et os.cpu_count() décrivent la machine virtuelle, pas
            # l'ordinateur. L'application Windows qui lance le backend transmet les vrais chiffres.
            memory = int(os.environ.get(HOST_MEMORY_VARIABLE) or 0)
            cpus = int(os.environ.get(HOST_CPUS_VARIABLE) or 0) or cpus
        else:
            memory = linux_total_memory(Path("/proc/meminfo").read_text(encoding="utf-8"))
    except (OSError, ValueError, subprocess.SubprocessError):
        memory = 0
    return {"memory": memory, "cpus": cpus}


def running_in_wsl():
    """Vrai quand le backend tourne dans WSL (environnement Linux du gestionnaire sous Windows)."""
    return "microsoft" in platform.release().lower()


def linux_total_memory(meminfo):
    for line in meminfo.splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) * 1024
    return 0


def windows_total_memory():
    class MemoryStatus(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    status = MemoryStatus()
    status.dwLength = ctypes.sizeof(MemoryStatus)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):  # type: ignore[attr-defined]
        return 0
    return int(status.ullTotalPhys)


def recommended_docker_resources(host_memory, host_cpus):
    """Mémoire, processeurs et swap à donner à Docker sur cet ordinateur.

    8 Go → 4 Go, 16 Go → 10 Go, 32 Go → 20 Go : le système garde au moins 4 Go (35 % au-delà).
    Les processeurs : tous jusqu'à 4, puis tous sauf deux.
    """
    if host_memory <= 0:
        return None
    reserved = max(HOST_RESERVED_MIN, host_memory * HOST_RESERVED_SHARE)
    memory = max(DOCKER_MEMORY_MIN, int((host_memory - reserved) // GIB) * GIB)
    cpus = host_cpus if host_cpus <= 4 else host_cpus - 2
    swap = min(SWAP_MAX, max(SWAP_MIN, int(memory // 4 // GIB) * GIB))
    return {"memory": memory, "cpus": max(1, cpus), "swap": swap}


def resources_status(current_memory, current_cpus, recommended):
    """« critical » sous 3 Go, « low » sous la recommandation, sinon « ok »."""
    if current_memory and current_memory < DOCKER_MEMORY_CRITICAL:
        return "critical"
    if not recommended or not current_memory:
        return "unknown"
    # Docker annonce un peu moins que ce qui lui est alloué (mémoire réservée par le noyau).
    if current_memory < recommended["memory"] * 0.9 or current_cpus < recommended["cpus"]:
        return "low"
    return "ok"


def postgres_settings(memory, cpus, server_version_num=0):
    """Réglages PostgreSQL d'un projet d'après la mémoire et les processeurs dont dispose Docker.

    Chaque projet a son propre PostgreSQL : un huitième de la mémoire chacun laisse la place à deux
    ou trois projets démarrés en même temps, à Odoo et au cache du système.
    """
    memory = memory or 2 * GIB
    cpus = max(int(cpus or 1), 1)
    settings = {
        "shared_buffers": f"{clamp_mib(memory / 8, 128, 2048)}MB",
        "effective_cache_size": f"{clamp_mib(memory / 2, 512, 32768)}MB",
        "maintenance_work_mem": f"{clamp_mib(memory / 16, 64, 1024)}MB",
        "work_mem": "16MB" if memory <= 4 * GIB else "32MB",
        # Moins de points de contrôle pendant les grosses écritures (restauration, mise à jour).
        "max_wal_size": "2GB",
        "min_wal_size": "256MB",
        "checkpoint_timeout": "15min",
        "checkpoint_completion_target": "0.9",
        # Base locale de développement : un arrêt brutal perd au plus la dernière seconde, sans
        # corrompre la base, et chaque validation n'attend plus l'écriture sur disque.
        "synchronous_commit": "off",
        # Disques SSD : lire au hasard coûte presque autant que lire à la suite.
        "random_page_cost": "1.1",
        "effective_io_concurrency": "200",
        "max_parallel_workers_per_gather": str(min(2, cpus // 2)),
    }
    if not server_version_num or server_version_num >= 110000:
        settings["max_parallel_maintenance_workers"] = str(min(4, cpus // 2))
    return settings


def clamp_mib(value, minimum, maximum):
    return int(max(minimum, min(maximum, value // MIB)))


def describe_postgres_settings(settings):
    """Résumé lisible des réglages principaux, pour le journal."""
    return (
        (
            f"cache {settings['shared_buffers']}, index {settings['maintenance_work_mem']}, "
            f"requêtes {settings['work_mem']}, journal {settings['max_wal_size']}"
        )
        .replace("MB", " Mo")
        .replace("GB", " Go")
    )


def docker_desktop_settings_path(directory=None):
    """(fichier de réglages de Docker Desktop, noms de ses clés), ou (None, None) s'il n'existe pas."""
    directory = Path(directory or DOCKER_DESKTOP_SETTINGS_DIR)
    for filename, keys in DOCKER_DESKTOP_SETTINGS_FILES:
        path = directory / filename
        if path.is_file():
            return path, keys
    return None, None


DOCKER_DESKTOP_SETTINGS_UNREADABLE = (
    "Les réglages de Docker Desktop ne sont pas accessibles. macOS protège les données des autres apps : "
    "autorise SDK Local Manager quand macOS le demande (ou dans Réglages Système › Confidentialité et sécurité), "
    "ou règle la mémoire dans Docker Desktop › Settings › Resources."
)


def check_docker_desktop_settings(directory=None):
    """Lit le fichier de réglages de Docker Desktop et retourne son chemin.

    macOS demande l'autorisation d'accéder aux données d'une autre app à la première lecture : elle
    a lieu avant d'arrêter Docker Desktop, pour ne pas le laisser arrêté sur un refus.
    """
    path, _keys = docker_desktop_settings_path(directory)
    if not path:
        raise RuntimeError(DOCKER_DESKTOP_SETTINGS_UNREADABLE)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except PermissionError as exc:
        raise RuntimeError(DOCKER_DESKTOP_SETTINGS_UNREADABLE) from exc
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Réglages de Docker Desktop illisibles ({path}) : {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"Réglages de Docker Desktop illisibles : {path}")
    return path


def write_docker_desktop_resources(memory, cpus, swap, directory=None):
    """Écrit la mémoire, les processeurs et le swap dans le fichier de Docker Desktop, le reste intact.

    Docker Desktop réécrit ce fichier en s'arrêtant : il doit être arrêté avant l'écriture.
    Retourne le chemin modifié.
    """
    path = check_docker_desktop_settings(directory)
    keys = dict(DOCKER_DESKTOP_SETTINGS_FILES)[path.name]
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload[keys["memory"]] = int(memory // MIB)
    payload[keys["cpus"]] = int(cpus)
    payload[keys["swap"]] = max(int(swap // MIB), int(payload.get(keys["swap"]) or 0))
    backup = path.with_name(path.name + ".odoo-manager.bak")
    if not backup.exists():
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    temporary = path.with_name(path.name + ".odoo-manager.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    return path


def format_gib(value):
    return f"{value / GIB:.0f} Go" if value >= GIB else f"{value / MIB:.0f} Mo"
