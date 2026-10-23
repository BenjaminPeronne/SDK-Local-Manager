"""Sauvegardes des clients Sudokeys, récupérées comme le fait `brainkeys datagraber`.

Le compte de l'utilisateur sur l'Odoo de Sudokeys (www.sudokeys.com, base sudokeys-prod) donne accès
aux fiches `sudokeys.dev.backup` qui le citent : chacune porte l'adresse d'un stockage S3 et ses clés.
Chaque bucket de ce stockage contient des sauvegardes ZIP Odoo nommées
`<préfixe>__<projet>__<branche>__…__<base>__<suffixe>`, que brainkeys range par projet, branche et base.

Le backend n'utilise que la bibliothèque standard : XML-RPC pour Odoo et requêtes S3 signées à la main
(Signature Version 4), sans boto3. Les clés S3 restent dans le backend, l'interface ne les voit jamais.
"""

import hashlib
import hmac
import http.client
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import xmlrpc.client
from dataclasses import dataclass, field
from datetime import UTC, datetime

SUDOKEYS_URL = "https://www.sudokeys.com"
SUDOKEYS_DATABASE = "sudokeys-prod"
BACKUP_MODEL = "sudokeys.dev.backup"

# Région de signature de boto3 quand rien n'est configuré, ce que fait brainkeys.
DEFAULT_REGION = "us-east-1"
EMPTY_PAYLOAD_SHA256 = hashlib.sha256(b"").hexdigest()
URI_SAFE = "-_.~"

ODOO_TIMEOUT_SECONDS = 30
S3_TIMEOUT_SECONDS = 60
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
# Coupures réseau successives tolérées pendant un téléchargement, reprises là où il s'était arrêté.
DOWNLOAD_RETRIES = 5

BACKUP_KEY_MIN_PARTS = 6


class RemoteBackupError(RuntimeError):
    """Échec compréhensible par l'utilisateur : le message est affiché tel quel."""


@dataclass(frozen=True)
class S3Access:
    endpoint: str
    access_key: str = field(repr=False)
    secret_key: str = field(repr=False)


@dataclass(frozen=True)
class RemoteBackup:
    access: S3Access
    bucket: str
    key: str
    size: int
    last_modified: str
    project: str
    branch: str
    database: str

    @property
    def id(self):
        """Identifiant stable, sans rien révéler du stockage : l'interface désigne la sauvegarde par lui."""
        raw = "\n".join((self.access.endpoint, self.bucket, self.key))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

    @property
    def filename(self):
        name = self.key.rsplit("/", 1)[-1] or "backup"
        return name if name.lower().endswith(".zip") else f"{name}.zip"

    def to_payload(self):
        return {
            "id": self.id,
            "project": self.project,
            "branch": self.branch,
            "database": self.database,
            "filename": self.filename,
            "size": self.size,
            "last_modified": self.last_modified,
        }


def parse_backup_key(key):
    """(projet, branche, base) d'après le nom du fichier, ou None s'il ne suit pas le nommage attendu.

    Même découpage que brainkeys : la base est formée des avant-dernier et antépénultième morceaux.
    """
    name = str(key or "").rsplit("/", 1)[-1]
    parts = [part.strip() for part in name.split("__")]
    if len(parts) < BACKUP_KEY_MIN_PARTS:
        return None
    project, branch, database = parts[1], parts[2], f"{parts[-3]}__{parts[-2]}"
    if not project or not branch:
        return None
    return project, branch, database


# --- Odoo Sudokeys -------------------------------------------------------------------------------


class _TimeoutTransport(xmlrpc.client.Transport):
    def __init__(self, timeout, **kwargs):
        super().__init__(**kwargs)
        self._timeout = timeout

    def make_connection(self, host):
        connection = super().make_connection(host)
        connection.timeout = self._timeout
        return connection


class _TimeoutSafeTransport(xmlrpc.client.SafeTransport):
    def __init__(self, timeout, **kwargs):
        super().__init__(**kwargs)
        self._timeout = timeout

    def make_connection(self, host):
        connection = super().make_connection(host)
        connection.timeout = self._timeout
        return connection


def _server_proxy(url, timeout):
    transport = _TimeoutSafeTransport(timeout) if url.startswith("https://") else _TimeoutTransport(timeout)
    return xmlrpc.client.ServerProxy(url, transport=transport, allow_none=True)


def fetch_backup_accesses(
    login, password, url=SUDOKEYS_URL, database=SUDOKEYS_DATABASE, timeout=ODOO_TIMEOUT_SECONDS, proxy=None
):
    """Stockages S3 ouverts au compte Sudokeys `login`.

    `proxy(url)` remplace la connexion XML-RPC dans les tests.
    """
    proxy = proxy or (lambda endpoint: _server_proxy(endpoint, timeout))
    url = url.rstrip("/")
    try:
        uid = proxy(f"{url}/xmlrpc/2/common").authenticate(database, login, password, {})
        if not uid:
            raise RemoteBackupError(
                "Identifiant ou mot de passe refusé par sudokeys.com. Vérifie-les, ou utilise une clé API "
                "si la double authentification est activée sur ton compte."
            )
        records = proxy(f"{url}/xmlrpc/2/object").execute_kw(
            database,
            uid,
            password,
            BACKUP_MODEL,
            "search_read",
            [[("user_ids", "in", [uid])]],
            {"fields": ["url", "token", "secret"]},
        )
    except xmlrpc.client.Fault as exc:
        raise RemoteBackupError(f"sudokeys.com a refusé la demande : {exc.faultString}") from exc
    except (OSError, http.client.HTTPException, xmlrpc.client.ProtocolError) as exc:
        raise RemoteBackupError(f"Impossible de joindre sudokeys.com : {exc}") from exc

    accesses = []
    for record in records or []:
        endpoint = str(record.get("url") or "").strip()
        access_key = str(record.get("token") or "").strip()
        secret_key = str(record.get("secret") or "").strip()
        if endpoint and access_key and secret_key:
            accesses.append(S3Access(endpoint, access_key, secret_key))
    if not accesses:
        raise RemoteBackupError(
            f"Ton compte {login} n'a accès à aucune sauvegarde. Demande à un administrateur de t'ajouter "
            "sur la fiche des sauvegardes du client concerné."
        )
    return accesses


# --- S3 ------------------------------------------------------------------------------------------


class S3Error(RemoteBackupError):
    def __init__(self, message, status=0, code="", region=""):
        super().__init__(message)
        self.status = status
        self.code = code
        self.region = region


def _local_name(tag):
    return tag.rsplit("}", 1)[-1]


def _children(element, name):
    return [child for child in element if _local_name(child.tag) == name]


def _child_text(element, name, default=""):
    for child in element:
        if _local_name(child.tag) == name:
            return child.text or default
    return default


def _quote(value, safe=URI_SAFE):
    return urllib.parse.quote(str(value), safe=safe)


def canonical_query(params):
    return "&".join(f"{_quote(key)}={_quote(value)}" for key, value in sorted((params or {}).items()))


def sign_request(method, url, access_key, secret_key, region, now=None, payload_hash=EMPTY_PAYLOAD_SHA256):
    """En-têtes d'une requête S3 signée (Signature Version 4). `url` porte déjà sa query canonique."""
    now = now or datetime.now(UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    day = now.strftime("%Y%m%d")
    parts = urllib.parse.urlsplit(url)
    headers = {"host": parts.netloc, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{name}:{headers[name]}\n" for name in sorted(headers))
    canonical = "\n".join((method, parts.path or "/", parts.query, canonical_headers, signed_headers, payload_hash))
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(("AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode("utf-8")).hexdigest()))
    key = f"AWS4{secret_key}".encode()
    for part in (day, region, "s3", "aws4_request"):
        key = hmac.new(key, part.encode("utf-8"), hashlib.sha256).digest()
    signature = hmac.new(key, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    headers["authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
    return headers


def _error_from_http(exc):
    body = b""
    try:
        body = exc.read(64 * 1024)
    except OSError:
        pass
    finally:
        exc.close()
    code = region = message = ""
    try:
        root = ET.fromstring(body)
        code, message, region = (_child_text(root, name) for name in ("Code", "Message", "Region"))
    except ET.ParseError:
        pass
    if exc.code == 403 and code in {"", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"}:
        text = "Le stockage des sauvegardes a refusé l'accès : préviens l'équipe infrastructure."
    else:
        text = f"Le stockage des sauvegardes a répondu {exc.code}" + (f" ({code}: {message})" if code else "") + "."
    return S3Error(text, exc.code, code, region)


class S3Client:
    """Lecture d'un stockage S3 : liste des buckets et des objets, téléchargement par morceaux.

    Les buckets sont adressés dans le chemin (https://hôte/bucket/clé), forme acceptée par tous les
    stockages compatibles ; un refus essaie ensuite la forme https://bucket.hôte/clé.
    """

    def __init__(self, access, opener=None, timeout=S3_TIMEOUT_SECONDS):
        self.access = access
        self.region = DEFAULT_REGION
        self.timeout = timeout
        self._open = opener or (lambda request, timeout: urllib.request.urlopen(request, timeout=timeout))
        self._virtual_hosted = False
        endpoint = access.endpoint if "://" in access.endpoint else f"https://{access.endpoint}"
        parts = urllib.parse.urlsplit(endpoint)
        self._scheme, self._host, self._base_path = parts.scheme, parts.netloc, parts.path.rstrip("/")

    def _url(self, bucket="", key="", params=None, virtual_hosted=False):
        host, path = self._host, self._base_path
        if bucket and virtual_hosted:
            host = f"{bucket}.{host}"
        elif bucket:
            path += "/" + _quote(bucket)
        path += "/" + _quote(key, safe=URI_SAFE + "/") if key else ("" if bucket else "/")
        query = canonical_query(params)
        return urllib.parse.urlunsplit((self._scheme, host, path or "/", query, ""))

    def _request(self, bucket="", key="", params=None, headers=None):
        styles = [self._virtual_hosted] if not bucket else [self._virtual_hosted, not self._virtual_hosted]
        first_error = None
        for virtual_hosted in styles:
            for _attempt in range(2):
                url = self._url(bucket, key, params, virtual_hosted)
                signed = sign_request("GET", url, self.access.access_key, self.access.secret_key, self.region)
                request = urllib.request.Request(url, headers={**signed, **(headers or {})}, method="GET")
                try:
                    response = self._open(request, self.timeout)
                except urllib.error.HTTPError as exc:
                    error = _error_from_http(exc)
                    # Mauvaise région de signature : S3 indique la bonne, comme le gère boto3.
                    if error.region and error.region != self.region:
                        self.region = error.region
                        continue
                    first_error = first_error or error
                    break
                except (urllib.error.URLError, OSError, http.client.HTTPException) as exc:
                    reason = getattr(exc, "reason", exc)
                    first_error = first_error or S3Error(f"Stockage des sauvegardes injoignable : {reason}")
                    break
                self._virtual_hosted = virtual_hosted
                return response
        raise first_error

    def _xml(self, bucket="", params=None):
        with self._request(bucket, params=params) as response:
            return ET.fromstring(response.read())

    def list_buckets(self):
        root = self._xml()
        return [
            _child_text(bucket, "Name")
            for buckets in _children(root, "Buckets")
            for bucket in _children(buckets, "Bucket")
            if _child_text(bucket, "Name")
        ]

    def list_objects(self, bucket):
        """Tous les objets du bucket (ListObjectsV2, page après page)."""
        params = {"list-type": "2"}
        while True:
            root = self._xml(bucket, params)
            for item in _children(root, "Contents"):
                yield {
                    "key": _child_text(item, "Key"),
                    "size": int(_child_text(item, "Size", "0") or 0),
                    "last_modified": _child_text(item, "LastModified"),
                }
            token = _child_text(root, "NextContinuationToken")
            if _child_text(root, "IsTruncated").lower() != "true" or not token:
                return
            params = {"list-type": "2", "continuation-token": token}

    def open_object(self, bucket, key, start=0):
        headers = {"Range": f"bytes={start}-"} if start else None
        return self._request(bucket, key, headers=headers)


def list_backups(accesses, client_factory=S3Client):
    """(sauvegardes du plus récent au plus ancien, nombre de fichiers au nommage inattendu)."""
    backups = []
    ignored = 0
    for access in accesses:
        client = client_factory(access)
        for bucket in client.list_buckets():
            for item in client.list_objects(bucket):
                if not item["key"] or item["key"].endswith("/"):
                    continue
                parsed = parse_backup_key(item["key"])
                if parsed is None:
                    ignored += 1
                    continue
                project, branch, database = parsed
                backups.append(
                    RemoteBackup(
                        access,
                        bucket,
                        item["key"],
                        item["size"],
                        item["last_modified"],
                        project,
                        branch,
                        database,
                    )
                )
    backups.sort(key=lambda backup: (backup.last_modified, backup.key), reverse=True)
    return backups, ignored


CONTENT_RANGE_RE = re.compile(r"^bytes (\d+)-")


def download_backup(backup, destination, *, client=None, on_progress=None, checkpoint=None, log=None):
    """Télécharge la sauvegarde dans `destination`, en reprenant là où une coupure l'a arrêtée.

    `on_progress(octets reçus, total)` suit l'avancement, `checkpoint()` permet d'arrêter l'action.
    """
    client = client or S3Client(backup.access)
    total = backup.size
    failures = 0
    with open(destination, "wb") as target:
        while True:
            position = target.tell()
            if total and position >= total:
                break
            try:
                with client.open_object(backup.bucket, backup.key, position) as response:
                    if position and not CONTENT_RANGE_RE.match(response.headers.get("Content-Range", "")):
                        # Reprise refusée par le stockage : tout repart du début.
                        target.seek(0)
                        target.truncate()
                    while True:
                        if checkpoint:
                            checkpoint()
                        chunk = response.read(DOWNLOAD_CHUNK_BYTES)
                        if not chunk:
                            break
                        target.write(chunk)
                        failures = 0
                        if on_progress:
                            on_progress(target.tell(), total)
            except (OSError, http.client.HTTPException, S3Error) as exc:
                if isinstance(exc, S3Error) and 400 <= exc.status < 500:
                    # Accès refusé ou fichier disparu : réessayer n'y changerait rien.
                    raise
                failures += 1
                if failures > DOWNLOAD_RETRIES:
                    raise RemoteBackupError(f"Téléchargement interrompu : {exc}") from exc
                if log:
                    log(f"Connexion coupée ({exc}) : reprise du téléchargement…")
                continue
            if not total:
                break
            if target.tell() < total:
                failures += 1
                if failures > DOWNLOAD_RETRIES:
                    raise RemoteBackupError("Téléchargement incomplet : le stockage a coupé la connexion.")
    size = destination.stat().st_size
    if total and size != total:
        raise RemoteBackupError(f"Téléchargement incomplet : {size} octets reçus sur {total}.")
    return size
