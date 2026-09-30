"""Espace disque occupé par les projets, la corbeille du gestionnaire et Docker.

Fonctions pures : le backend fournit la sortie de `du` et de Docker, ce module l'interprète.
"""

import re

# Nom d'un projet déplacé dans la corbeille par delete_project_job : AAAAMMJJ_HHMMSS_<projet>.
TRASH_ENTRY_RE = re.compile(r"^(?P<date>\d{8})_(?P<time>\d{6})_(?P<project>[A-Za-z0-9][A-Za-z0-9_.-]*)$")
DOCKER_SIZE_RE = re.compile(r"^\s*(?P<value>[0-9]+(?:\.[0-9]+)?)\s*(?P<unit>[kKMGT]?i?B)\s*$")
DOCKER_UNITS = {"B": 1, "KB": 1000, "MB": 1000**2, "GB": 1000**3, "TB": 1000**4}
COMPOSE_IMAGE_RE = re.compile(r"^\s*image:\s*[\"']?(?P<image>[^\s\"'#]+)", re.MULTILINE)


def parse_du_output(output):
    """{chemin: octets} depuis `du -k` (une ligne « taille<TAB>chemin » par dossier)."""
    sizes = {}
    for line in output.splitlines():
        size, _, path = line.partition("\t")
        if size.strip().isdigit() and path:
            sizes[path.rstrip("/")] = int(size) * 1024
    return sizes


def parse_docker_size(text):
    """Taille affichée par Docker (« 1.2GB », « 512MB », « 0B ») en octets, 0 si illisible."""
    match = DOCKER_SIZE_RE.match(str(text or "").split("(")[0])
    if not match:
        return 0
    unit = match.group("unit").upper().replace("I", "")
    return int(float(match.group("value")) * DOCKER_UNITS.get(unit, 1))


def trash_entry(name):
    """Projet et date de suppression d'une entrée de la corbeille, ou None pour un nom inconnu."""
    match = TRASH_ENTRY_RE.match(name)
    if not match:
        return None
    date, clock = match.group("date"), match.group("time")
    return {
        "name": name,
        "project": match.group("project"),
        "deleted_at": f"{date[:4]}-{date[4:6]}-{date[6:]} {clock[:2]}:{clock[2:4]}",
    }


def normalize_image_reference(reference):
    """`postgres` et `postgres:latest` désignent la même image ; un digest reste tel quel."""
    reference = reference.strip()
    if "@" in reference:
        return reference
    name = reference.rsplit("/", 1)[-1]
    return reference if ":" in name else f"{reference}:latest"


def compose_image_references(text):
    """Images déclarées par un fichier docker-compose."""
    return {normalize_image_reference(match.group("image")) for match in COMPOSE_IMAGE_RE.finditer(text)}


def unused_images(images, used_image_ids, referenced):
    """Images qu'aucun conteneur n'utilise et qu'aucun projet ne déclare.

    Une image déclarée par un projet arrêté reste : `docker-odoo-local` n'est pas toujours
    téléchargeable de nouveau, et le projet ne redémarrerait plus.
    """
    referenced = {normalize_image_reference(reference) for reference in referenced}
    unused = []
    for image in images:
        reference = f"{image['repository']}:{image['tag']}"
        dangling = image["repository"] == "<none>" or image["tag"] == "<none>"
        if image["id"] in used_image_ids:
            continue
        if not dangling and normalize_image_reference(reference) in referenced:
            continue
        unused.append({**image, "reference": "image orpheline" if dangling else reference})
    return unused
