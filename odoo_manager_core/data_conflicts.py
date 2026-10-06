"""Données d'un module qui butent sur un enregistrement déjà présent dans la base.

Une nouvelle version d'un module apporte des données (cantons suisses, pays, paramètres…) avec
leur identifiant XML. Si la base contient déjà un enregistrement de même clé, créé à la main ou
par une ancienne version sans cet identifiant, Odoo tente de le créer une seconde fois et la mise
à jour échoue sur l'unicité :

    loading base/data/res.country.state.csv
    duplicate key value violates unique constraint "res_country_state_name_code_uniq"
    DETAIL:  Key (country_id, code)=(43, ZH) already exists.

La migration d'Odoo rattache ces enregistrements au module. Ici aussi : le fichier de données est
relu, chaque ligne est rapprochée de l'enregistrement existant par les colonnes de la clé en
double, et l'identifiant XML manquant lui est attribué. Odoo le met alors à jour au lieu de le
recréer. Vaut pour les fichiers CSV comme XML, de toutes les versions d'Odoo.

Fonctions pures : le backend fournit le journal, le contenu du fichier et les types de colonnes.
"""

import ast
import csv
import io
import re
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass

# Odoo journalise chaque fichier de données qu'il charge (odoo/modules/loading.py, load_data).
LOADING_FILE_RE = re.compile(r"odoo\.modules\.loading: loading (?P<module>\w+)/(?P<path>[\w./-]+\.(?:csv|xml))\b")
INSERT_TABLE_RE = re.compile(r'INSERT INTO "?(?P<table>\w+)"?')
DUPLICATE_KEY_RE = re.compile(
    r'duplicate key value violates unique constraint "(?P<constraint>[\w.]+)"\s*'
    r"DETAIL:\s+Key \((?P<columns>[^)]+)\)=\((?P<values>.*?)\) already exists",
    re.DOTALL,
)
ADDONS_PATHS_RE = re.compile(r"odoo: addons paths: (?P<paths>\[.*\])")
REF_EVAL_RE = re.compile(r"""^\s*ref\(\s*['"](?P<xmlid>[\w.]+)['"]\s*\)\s*$""")
SQL_IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


@dataclass(frozen=True)
class DataConflict:
    """Fichier de données dont une ligne existe déjà dans la base sous une autre identité."""

    module: str
    path: str
    table: str
    columns: tuple
    values: str

    @property
    def key(self):
        return f"{self.module}/{self.path}"

    def describe(self):
        return f"{self.table} ({', '.join(self.columns)}) = ({self.values})"


def find_data_conflict(log_text):
    """Dernière collision de données dans le journal d'une commande Odoo, ou None."""
    matches = list(DUPLICATE_KEY_RE.finditer(log_text))
    if not matches:
        return None
    duplicate = matches[-1]
    before = log_text[: duplicate.start()]
    loading = list(LOADING_FILE_RE.finditer(before))
    inserts = list(INSERT_TABLE_RE.finditer(before))
    if not loading or not inserts:
        return None
    columns = tuple(column.strip().strip('"') for column in duplicate.group("columns").split(","))
    if not all(SQL_IDENTIFIER_RE.match(column) for column in columns):
        return None
    table = inserts[-1].group("table")
    if not SQL_IDENTIFIER_RE.match(table):
        return None
    return DataConflict(
        module=loading[-1].group("module"),
        path=loading[-1].group("path"),
        table=table,
        columns=columns,
        values=duplicate.group("values")[:200],
    )


def addons_paths(log_text):
    """Chemins des addons annoncés par Odoo au démarrage de la commande."""
    match = ADDONS_PATHS_RE.search(log_text)
    if not match:
        return []
    try:
        paths = ast.literal_eval(match.group("paths"))
    except (ValueError, SyntaxError):
        return []
    return [str(path) for path in paths if isinstance(path, str) and path.startswith("/")]


@dataclass(frozen=True)
class DataRecord:
    """Ligne d'un fichier de données : identifiant XML et valeurs des colonnes de la clé."""

    xmlid: str
    values: tuple  # (valeur, est_une_référence) par colonne de la clé
    noupdate: bool


def qualified_xmlid(module, xmlid):
    return xmlid if "." in xmlid else f"{module}.{xmlid}"


def csv_records(content, model_table, module, columns):
    """Lignes d'un fichier CSV dont toutes les colonnes de la clé sont connues.

    Le nom du fichier est celui du modèle (res.country.state.csv) ; une colonne many2one s'y
    écrit `country_id:id` ou `country_id/id` et porte un identifiant XML.
    """
    rows = list(csv.reader(io.StringIO(content)))
    if not rows:
        return []
    header = [name.strip() for name in rows[0]]
    if "id" not in header:
        return []
    positions = []
    for column in columns:
        if column in header:
            positions.append((header.index(column), False))
        elif f"{column}:id" in header:
            positions.append((header.index(f"{column}:id"), True))
        elif f"{column}/id" in header:
            positions.append((header.index(f"{column}/id"), True))
        else:
            return []
    records = []
    xmlid_position = header.index("id")
    for row in rows[1:]:
        if len(row) < len(header) or not row[xmlid_position].strip():
            continue
        values = []
        for position, is_reference in positions:
            value = row[position].strip()
            values.append((qualified_xmlid(module, value) if is_reference and value else value, is_reference))
        records.append(DataRecord(qualified_xmlid(module, row[xmlid_position].strip()), tuple(values), False))
    return records


def xml_field_value(field, module):
    """(valeur, est_une_référence) d'un champ XML simple, None s'il est calculé."""
    if field.get("ref"):
        return qualified_xmlid(module, field.get("ref")), True
    expression = field.get("eval")
    if expression is not None:
        reference = REF_EVAL_RE.match(expression)
        if reference:
            return qualified_xmlid(module, reference.group("xmlid")), True
        try:
            value = ast.literal_eval(expression)
        except (ValueError, SyntaxError):
            return None
        if isinstance(value, bool):
            return ("true" if value else "false"), False
        if isinstance(value, (int, float, str)):
            return str(value), False
        return None
    if len(field):
        return None
    return (field.text or "").strip(), False


def xml_records(content, model_table, module, columns):
    """(enregistrements <record> de la table aux champs de clé simples, modèle Odoo de ces enregistrements).

    `ir.mail_server` a pour table `ir_mail_server` : le modèle se lit dans le fichier, pas dans la table.
    """
    try:
        root = ElementTree.fromstring(content.encode("utf-8") if isinstance(content, str) else content)
    except ElementTree.ParseError:
        return [], ""
    records = []
    models = set()

    def walk(node, noupdate):
        noupdate = node.get("noupdate", "0").lower() in {"1", "true"} if "noupdate" in node.attrib else noupdate
        for child in node:
            if child.tag == "record":
                record = xml_record(child, noupdate)
                if record:
                    records.append(record)
            elif child.tag in {"data", "odoo", "openerp"}:
                walk(child, noupdate)

    def xml_record(node, noupdate):
        model = node.get("model", "")
        xmlid = node.get("id", "")
        if not xmlid or model.replace(".", "_") != model_table:
            return None
        models.add(model)
        fields = {field.get("name"): field for field in node.findall("field")}
        values = []
        for column in columns:
            if column not in fields:
                return None
            value = xml_field_value(fields[column], module)
            if value is None:
                return None
            values.append(value)
        return DataRecord(qualified_xmlid(module, xmlid), tuple(values), noupdate)

    walk(root, root.get("noupdate", "0").lower() in {"1", "true"})
    return records, (models.pop() if len(models) == 1 else "")


def data_records(conflict, content):
    """(modèle Odoo, lignes du fichier en conflit), quel que soit son format ; ("", []) sinon."""
    if conflict.path.endswith(".csv"):
        # Le fichier CSV porte le nom du modèle : res.country.state.csv pour res_country_state.
        model = conflict.path.rsplit("/", 1)[-1][: -len(".csv")]
        if model.replace(".", "_") != conflict.table:
            return "", []
        return model, csv_records(content, conflict.table, conflict.module, conflict.columns)
    records, model = xml_records(content, conflict.table, conflict.module, conflict.columns)
    return model, records


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def adoption_sql(conflict, model, records, column_types):
    """SQL qui rattache aux lignes du fichier les enregistrements existants de même clé.

    `column_types` : type PostgreSQL de chaque colonne de la clé. Une colonne traduite (jsonb,
    Odoo 16 et suivants) est comparée sur sa valeur anglaise, comme Odoo l'écrit au chargement.
    Retourne "" s'il n'y a rien à rapprocher. Le résultat liste les identifiants créés.
    """
    if not records or not SQL_IDENTIFIER_RE.match(conflict.table):
        return ""
    width = len(conflict.columns)
    value_rows = []
    for record in records:
        module, _separator, name = record.xmlid.partition(".")
        cells = [sql_literal(module), sql_literal(name), "true" if record.noupdate else "false"]
        cells += [sql_literal(value) for value, _reference in record.values]
        value_rows.append("(" + ", ".join(cells) + ")")
    references = [is_reference for _value, is_reference in records[0].values]
    keys = [f"k{index}" for index in range(width)]
    resolved = []
    joins = []
    for index, (column, is_reference) in enumerate(zip(conflict.columns, references, strict=True)):
        key = keys[index]
        if is_reference:
            resolved.append(
                f"(SELECT d.res_id FROM ir_model_data d WHERE d.module = split_part(c.{key}, '.', 1) "
                f"AND d.name = split_part(c.{key}, '.', 2) LIMIT 1) AS {key}"
            )
            joins.append(f't."{column}" = r.{key}')
        else:
            resolved.append(f"c.{key}")
            if column_types.get(column) == "jsonb":
                joins.append(f"t.\"{column}\"->>'en_US' = r.{key}")
            else:
                joins.append(f't."{column}"::text = r.{key}')
    return f"""
WITH candidate(xmlid_module, xmlid_name, noupdate, {", ".join(keys)}) AS (
    VALUES {", ".join(value_rows)}
),
resolved AS (
    SELECT c.xmlid_module, c.xmlid_name, c.noupdate, {", ".join(resolved)}
      FROM candidate c
     WHERE NOT EXISTS (
           SELECT 1 FROM ir_model_data d WHERE d.module = c.xmlid_module AND d.name = c.xmlid_name
     )
),
matched AS (
    SELECT DISTINCT ON (r.xmlid_module, r.xmlid_name) r.xmlid_module, r.xmlid_name, r.noupdate, t.id AS res_id
      FROM resolved r
      JOIN "{conflict.table}" t ON {" AND ".join(joins)}
     WHERE NOT EXISTS (
           SELECT 1 FROM ir_model_data d
            WHERE d.model = {sql_literal(model)} AND d.res_id = t.id AND d.module = r.xmlid_module
     )
     ORDER BY r.xmlid_module, r.xmlid_name, t.id
)
INSERT INTO ir_model_data (module, name, model, res_id, noupdate, create_uid, create_date, write_uid, write_date)
SELECT xmlid_module, xmlid_name, {sql_literal(model)}, res_id, noupdate,
       1, now() AT TIME ZONE 'UTC', 1, now() AT TIME ZONE 'UTC'
  FROM matched
RETURNING module || '.' || name;
""".strip()
