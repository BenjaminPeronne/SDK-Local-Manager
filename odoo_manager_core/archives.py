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


MAX_MULTIPART_HEADER_BYTES = 16 * 1024
MAX_MULTIPART_FIELD_BYTES = 64 * 1024


class _Discard:
    def write(self, _data):
        return None


class _LimitedField:
    """Champ texte d'un formulaire : petit par nature, refusé au-delà de la limite."""

    def __init__(self, limit):
        self.limit = limit
        self.data = bytearray()

    def write(self, data):
        if len(self.data) + len(data) > self.limit:
            raise ValueError("Champ de formulaire trop volumineux.")
        self.data += data


def multipart_boundary(content_type):
    match = re.search(r"boundary=([^;]+)", content_type or "")
    if not match:
        raise ValueError("Boundary multipart manquante.")
    return match.group(1).strip().strip('"').encode("utf-8")


def save_multipart_upload(stream, content_length, content_type, destination, file_field, chunk_size=1024 * 1024):
    """Lit un formulaire multipart au fil de l'eau et écrit son fichier `file_field` dans `destination`.

    Le corps n'est jamais gardé entier en mémoire : un ZIP de 250 Mo occupait auparavant
    deux à trois fois sa taille le temps du découpage. Seuls les champs texte, plafonnés,
    restent en mémoire. Retourne (champs, nom du fichier envoyé), ce nom valant None si le
    formulaire ne contient pas `file_field`.
    """
    delimiter = b"\r\n--" + multipart_boundary(content_type)
    destination = Path(destination)
    remaining = int(content_length)
    # Le premier délimiteur n'est pas précédé d'un saut de ligne : on l'ajoute pour qu'un seul
    # motif reconnaisse tous les délimiteurs.
    buffer = b"\r\n"

    def fill():
        nonlocal buffer, remaining
        if remaining <= 0:
            return False
        chunk = stream.read(min(chunk_size, remaining))
        if not chunk:
            raise ValueError("Le téléversement a été interrompu.")
        remaining -= len(chunk)
        buffer += chunk
        return True

    def parse():
        nonlocal buffer
        while (index := buffer.find(delimiter)) < 0:
            if len(buffer) > MAX_MULTIPART_HEADER_BYTES or not fill():
                raise ValueError("Formulaire multipart illisible.")
        buffer = buffer[index + len(delimiter) :]

        fields = {}
        filename = None
        while True:
            while len(buffer) < 2 and fill():
                pass
            if buffer.startswith(b"--"):
                break
            while (header_end := buffer.find(b"\r\n\r\n")) < 0:
                if len(buffer) > MAX_MULTIPART_HEADER_BYTES or not fill():
                    raise ValueError("En-têtes multipart illisibles.")
            headers = {}
            for line in buffer[:header_end].decode("utf-8", errors="replace").split("\r\n"):
                key, separator, value = line.partition(":")
                if separator:
                    headers[key.strip().lower()] = value.strip()
            buffer = buffer[header_end + 4 :]
            disposition = headers.get("content-disposition", "")
            name_match = re.search(r'name="([^"]+)"', disposition)
            filename_match = re.search(r'filename="([^"]*)"', disposition)
            name = name_match.group(1) if name_match else ""

            output = None
            if filename_match and name == file_field and filename is None:
                output = destination.open("wb")
                sink = output
            elif filename_match or not name:
                sink = _Discard()
            else:
                sink = _LimitedField(MAX_MULTIPART_FIELD_BYTES)
            try:
                # Un délimiteur peut chevaucher deux morceaux : sa longueur moins un octet reste en attente.
                keep = len(delimiter) - 1
                while (index := buffer.find(delimiter)) < 0:
                    if len(buffer) > keep:
                        sink.write(buffer[:-keep])
                        buffer = buffer[-keep:]
                    if not fill():
                        raise ValueError("Formulaire multipart tronqué.")
                sink.write(buffer[:index])
                buffer = buffer[index + len(delimiter) :]
            finally:
                if output is not None:
                    output.close()
            if output is not None:
                filename = Path(filename_match.group(1)).name
            elif isinstance(sink, _LimitedField):
                fields[name] = sink.data.decode("utf-8", errors="replace")

        return fields, filename

    try:
        fields, filename = parse()
    except ValueError:
        # Refus en cours de lecture : le reste du corps est lu quand même. Sous Windows, fermer
        # la connexion sur des octets non lus la coupe, et l'interface perd le message d'erreur.
        try:
            while remaining > 0:
                buffer = b""
                fill()
        except ValueError:
            pass
        raise
    # Épilogue éventuel : lu pour que la connexion ne soit pas coupée avant la réponse.
    while remaining > 0:
        buffer = b""
        fill()
    return fields, filename


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
