"""Lecture des sorties de commandes : avancement chiffré, erreurs d'Odoo et dépendances Python manquantes.

Le backend y trouve de quoi remplir la barre de progression et expliquer un échec dans
la langue de l'utilisateur plutôt que dans celle de la commande.
"""

import html
import re

# Étapes de `git clone --progress`, dans l'ordre où Git les parcourt, avec la part de la
# récupération que chacune représente. Chaque étape repart de 0 % dans la sortie de Git :
# les mettre bout à bout donne une seule progression qui ne recule pas.
GIT_PROGRESS_PHASES = {
    "Counting objects": (0.0, 0.05),
    "Enumerating objects": (0.0, 0.05),
    "Compressing objects": (0.05, 0.05),
    "Receiving objects": (0.10, 0.65),
    "Resolving deltas": (0.75, 0.15),
    "Updating files": (0.90, 0.10),
    "Filtering content": (0.90, 0.10),
}


GIT_PROGRESS_RE = re.compile(
    r"^(?P<phase>[A-Za-z][A-Za-z ]+):\s+(?P<percent>\d{1,3})%\s*(?:\((?P<current>\d+)/(?P<total>\d+)\))?"
)


COUNTED_PROGRESS_RE = re.compile(r"^(?P<label>[^:]{3,60}):\s+(?P<current>\d+)/(?P<total>\d+)\s*$")


# Odoo annonce en INFO chaque module qu'il installe ou met à jour, avec sa place dans la liste
# des modules de la base.
ODOO_MODULE_LOADING_RE = re.compile(r"odoo\.modules\.loading: Loading module \S+ \((?P<index>\d+)/(?P<total>\d+)\)")


def parse_output_progress(text):
    """Avancement lu dans une ligne de sortie, ou None.

    Les étapes les plus longues sont des commandes externes : leur seule mesure d'avancement
    est ce qu'elles écrivent. Le résultat porte soit une `fraction` (0 à 1) de la commande,
    soit la place (`index`, `total`) d'un module Odoo dans la liste qu'il parcourt.
    `transient` marque une ligne que la commande réécrit en place, des centaines de fois :
    elle nourrit la barre, pas l'historique.

    Cette lecture ne fait que compléter l'avancement que les actions déclarent elles-mêmes
    quand elles le connaissent.
    """
    line = text.strip()
    # Le serveur Git préfixe ses propres étapes, réécrites elles aussi en place.
    if line.startswith("remote: "):
        line = line[len("remote: ") :]
    match = GIT_PROGRESS_RE.match(line)
    if match:
        phase = GIT_PROGRESS_PHASES.get(match.group("phase"))
        if phase is None:
            return None
        if match.group("total") and int(match.group("total")):
            done = min(int(match.group("current")) / int(match.group("total")), 1.0)
        else:
            done = min(int(match.group("percent")), 100) / 100
        offset, weight = phase
        return {"fraction": offset + weight * done, "transient": not line.endswith("done.")}
    match = COUNTED_PROGRESS_RE.match(line)
    if match and int(match.group("total")):
        return {
            "fraction": min(int(match.group("current")) / int(match.group("total")), 1.0),
            # Une ligne écrite par le gestionnaire lui-même : elle reste dans l'historique.
            "transient": False,
        }
    match = ODOO_MODULE_LOADING_RE.search(line)
    if match and int(match.group("total")):
        return {"index": int(match.group("index")), "total": int(match.group("total")), "transient": False}
    return None


def extract_odoo_page_error(content):
    if not content:
        return ""
    pattern = r'<div\b[^>]*class=["\'][^"\']*\balert-danger\b[^"\']*["\'][^>]*>(.*?)</div>'
    for match in re.finditer(pattern, content, flags=re.IGNORECASE | re.DOTALL):
        message = re.sub(r"<[^>]+>", " ", match.group(1))
        message = re.sub(r"\s+", " ", html.unescape(message)).strip()
        if message:
            return message
    return ""


def odoo_restore_error(content):
    if "Database restore error:" not in content:
        return ""
    # Le message est dans l'alerte de la page : sans ce ciblage, la suite du gestionnaire de
    # bases d'Odoo (boutons, liste de langues…) était recopiée dans l'erreur.
    alert = extract_odoo_page_error(content)
    if "Database restore error:" in alert:
        return alert[alert.find("Database restore error:") :][:800]
    plain = html.unescape(re.sub(r"<[^>]+>", " ", content))
    plain = re.sub(r"\s+", " ", plain).strip()
    marker = "Database restore error:"
    return plain[plain.find(marker) : plain.find(marker) + 800]


# Erreurs Odoo typiques d'une base qui référence le code d'un module absent du projet.
MISSING_CODE_ERROR_RE = re.compile(
    r"n'existe pas|does not exist|non-existing model|External ID not found|No module named|KeyError",
    re.IGNORECASE,
)


# Un module Python manquant se voit de deux façons : Odoo le détecte lui-même via
# external_dependencies (quand le manifeste le déclare) et le dit en clair, ou il n'est
# déclaré nulle part et casse au premier import réel, en français ou en anglais selon
# le point d'échec — les deux formes portent le nom d'import, pas forcément le nom pip.
MISSING_PYTHON_IMPORT_RE = re.compile(
    r"d[ée]pendance externe non trouv[ée]e\s*:\s*(?P<name1>[\w.\-]+)"
    r"|external dependenc\w* (?:is |are )?not (?:met|found)\s*:\s*(?P<name2>[\w.\-]+)"
    r"|(?:ModuleNotFoundError|ImportError)\s*:\s*No module named ['\"]?(?P<name3>[\w.]+)",
    re.IGNORECASE,
)


# Cas connus où le nom importé diverge du nom du paquet PyPI qui le fournit.
PIP_PACKAGE_ALIASES = {
    "pil": "Pillow",
    "cv2": "opencv-python",
    "yaml": "PyYAML",
    "crypto": "pycryptodome",
    "usb": "pyusb",
    "serial": "pyserial",
    "bs4": "beautifulsoup4",
    "dateutil": "python-dateutil",
    "openssl": "pyOpenSSL",
}


# Extension PostgreSQL (ex. pgvector pour l'IA) que le rôle applicatif odoo n'a pas le droit de
# créer lui-même : message brut de psycopg2/PostgreSQL, jamais localisé.
MISSING_POSTGRES_EXTENSION_RE = re.compile(r'permission denied to create extension "(?P<extension>[\w-]+)"')


# Doublon d'expression de rapport comptable : une base créée avec une version plus ancienne d'un
# module de localisation porte des expressions « balance » sans identifiant XML, que la version
# actuelle déclare explicitement. Odoo ne les reconnaît pas et tente d'en créer une seconde.
REPORT_EXPRESSION_DUPLICATE_RE = re.compile(r"account_report_expression_line_label_uniq")
PARSED_DATA_FILE_RE = re.compile(r"while parsing (?P<path>\S+?\.xml):\d+")


def report_expression_duplicate_module(message):
    """Module dont le fichier de données a déclenché un doublon d'expression de rapport ; "" sinon."""
    if not REPORT_EXPRESSION_DUPLICATE_RE.search(message):
        return ""
    match = PARSED_DATA_FILE_RE.search(message)
    if not match:
        return ""
    # …/addons/l10n_fr/data/tax_report_data.xml : le module est le dossier qui précède le sous-dossier.
    parts = [part for part in match.group("path").split("/") if part]
    return parts[-3] if len(parts) >= 3 and re.fullmatch(r"[a-z][a-z0-9_]*", parts[-3]) else ""


def missing_python_import(message):
    """Nom d'import Python manquant, déduit d'une erreur Odoo ou d'un traceback brut."""
    match = MISSING_PYTHON_IMPORT_RE.search(message)
    if not match:
        return ""
    name = match.group("name1") or match.group("name2") or match.group("name3")
    return name.split(".")[0]


def python_package_for_import(import_name):
    """Nom du paquet PyPI à installer pour satisfaire cet import (identique la plupart du temps)."""
    return PIP_PACKAGE_ALIASES.get(import_name.lower(), import_name)


def external_dependency_failure_hint(message):
    """Affiché quand l'installation automatique du paquet manquant a elle-même échoué."""
    import_name = missing_python_import(message)
    if not import_name:
        return ""
    package = python_package_for_import(import_name)
    return (
        f"Cause probable : le paquet Python « {package} » (dépendance externe du module) n'a pas pu être "
        "installé automatiquement dans le conteneur Odoo de ce projet (réseau, nom de paquet PyPI différent…). "
        "Ajoute-le manuellement à init/requirements_pip.txt à la racine du projet, puis relance."
    )
