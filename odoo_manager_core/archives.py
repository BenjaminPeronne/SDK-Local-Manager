"""Archives et téléversements : formulaires multipart, ZIP de modules et sauvegardes Odoo.

Chaque lecture refuse ce qui sortirait du dossier cible ou dépasserait les limites, avant
d'écrire quoi que ce soit.
"""

import collections
import json
import re
import stat
import zipfile
from pathlib import Path

SAFE_IMPORT_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")


MAX_ZIP_ENTRIES = 100_000


MAX_ZIP_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024


MAX_DATABASE_BACKUP_ENTRIES = 2_000_000


def parse_multipart_form(content_type, body):
    match = re.search(r"boundary=([^;]+)", content_type or "")
    if not match:
        raise ValueError("Boundary multipart manquante.")
    boundary = match.group(1).strip().strip('"').encode("utf-8")
    fields = {}
    files = {}

    for part in body.split(b"--" + boundary):
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2].strip(b"\r\n")
        header_blob, separator, payload = part.partition(b"\r\n\r\n")
        if not separator:
            continue
        headers = {}
        for line in header_blob.decode("utf-8", errors="replace").split("\r\n"):
            key, sep, value = line.partition(":")
            if sep:
                headers[key.strip().lower()] = value.strip()
        disposition = headers.get("content-disposition", "")
        name_match = re.search(r'name="([^"]+)"', disposition)
        if not name_match:
            continue
        name = name_match.group(1)
        filename_match = re.search(r'filename="([^"]*)"', disposition)
        payload = payload.rstrip(b"\r\n")
        if filename_match:
            files[name] = {
                "filename": Path(filename_match.group(1)).name,
                "data": payload,
            }
        else:
            fields[name] = payload.decode("utf-8", errors="replace")

    return fields, files


def validate_odoo_backup_archive(backup_path):
    backup_path = Path(backup_path)
    if not zipfile.is_zipfile(backup_path):
        raise ValueError("La sauvegarde n'est pas une archive ZIP Odoo valide.")

    try:
        with zipfile.ZipFile(backup_path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_DATABASE_BACKUP_ENTRIES:
                raise ValueError("La sauvegarde contient trop de fichiers.")
            names = {entry.filename.replace("\\", "/") for entry in entries}
            if "dump.sql" not in names:
                raise ValueError("Archive Odoo invalide: le fichier dump.sql est absent.")
            for entry in entries:
                normalized = entry.filename.replace("\\", "/")
                if normalized != "dump.sql" and not normalized.startswith("filestore/"):
                    continue
                parts = [part for part in normalized.split("/") if part]
                if normalized.startswith("/") or ".." in parts:
                    raise ValueError("Archive Odoo invalide: chemin de fichier dangereux.")
                if entry.flag_bits & 0x1:
                    raise ValueError("Les sauvegardes ZIP chiffrées ne sont pas prises en charge.")
            return {
                "entries": len(entries),
                "has_filestore": any(name.startswith("filestore/") for name in names),
                "has_manifest": "manifest.json" in names,
                "odoo_version": backup_odoo_version(archive) if "manifest.json" in names else "",
            }
    except zipfile.BadZipFile as exc:
        raise ValueError("La sauvegarde ZIP est illisible ou endommagée.") from exc


def backup_odoo_version(archive):
    """Version majeure d'Odoo qui a produit la sauvegarde (« 15.0 »), lue dans manifest.json."""
    try:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8", errors="replace"))
    except (KeyError, ValueError, OSError, zipfile.BadZipFile):
        return ""
    if not isinstance(manifest, dict):
        return ""
    for key in ("major_version", "version"):
        match = re.match(r"(?:saas~)?(\d+)\.(\d+)", str(manifest.get(key) or ""))
        if match:
            return f"{match.group(1)}.{match.group(2)}"
    # Certains outils d'export laissent version et major_version vides : les versions des
    # modules installés (« 15.0.1.5 ») portent alors la série, base en tête.
    modules = manifest.get("modules")
    if not isinstance(modules, dict):
        return ""
    series = collections.Counter()
    for name, module_version in modules.items():
        match = re.match(r"(\d+)\.(\d+)\.\d+", str(module_version or ""))
        if match:
            if name == "base":
                return f"{match.group(1)}.{match.group(2)}"
            series[f"{match.group(1)}.{match.group(2)}"] += 1
    return series.most_common(1)[0][0] if series else ""


def save_request_body_to_file(stream, content_length, destination, chunk_size=1024 * 1024):
    destination = Path(destination)
    remaining = int(content_length)
    with destination.open("wb") as output:
        while remaining:
            chunk = stream.read(min(chunk_size, remaining))
            if not chunk:
                raise ValueError("Le téléversement de la sauvegarde a été interrompu.")
            output.write(chunk)
            remaining -= len(chunk)
    return destination


def multipart_field(boundary, name, value):
    return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()


def safe_import_name(filename):
    stem = Path(filename or "modules").stem or "modules"
    return SAFE_IMPORT_NAME_RE.sub("_", stem).strip("._") or "modules"


def safe_extract_zip(zip_path, destination):
    destination.mkdir(parents=True, exist_ok=True)
    base = destination.resolve()
    skipped_links = []
    with zipfile.ZipFile(zip_path) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise RuntimeError(f"ZIP trop volumineux: plus de {MAX_ZIP_ENTRIES} entrées.")
        if sum(info.file_size for info in infos) > MAX_ZIP_UNCOMPRESSED_BYTES:
            raise RuntimeError("ZIP trop volumineux après décompression. Limite: 2 Go.")
        for info in infos:
            name = info.filename
            if not name or name.startswith(("/", "\\")):
                raise RuntimeError(f"Chemin ZIP invalide: {name}")
            if "\\" in name or "\x00" in name or re.match(r"^[A-Za-z]:", name):
                raise RuntimeError(f"Chemin ZIP invalide: {name}")
            parts = Path(name).parts
            if any(part == ".." for part in parts):
                raise RuntimeError(f"Chemin ZIP dangereux: {name}")
            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                skipped_links.append(name)
                continue
            if mode not in {0, stat.S_IFREG, stat.S_IFDIR}:
                raise RuntimeError(f"Type de fichier ZIP non pris en charge: {name}")
            target = (destination / name).resolve()
            if base != target and base not in target.parents:
                raise RuntimeError(f"Extraction hors dossier refusee: {name}")
        for info in infos:
            if info.filename in skipped_links:
                continue
            archive.extract(info, destination)
    return skipped_links
