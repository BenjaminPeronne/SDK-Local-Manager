import io
import tempfile
import unittest
import urllib.error
import urllib.parse
import xmlrpc.client
from datetime import UTC, datetime
from pathlib import Path

from odoo_manager_core import remote_backups
from odoo_manager_core.remote_backups import RemoteBackup, RemoteBackupError, S3Access, S3Client

ACCESS = S3Access("https://s3.example.test", "AKIDEXAMPLE", "secret")
KEY = "daily__client_a__main__x__client_a_prod__2026-10-22__0300.zip"


class FakeResponse(io.BytesIO):
    def __init__(self, data, headers=None):
        super().__init__(data)
        self.headers = headers or {}


class FakeProxy:
    def __init__(self, uid=7, records=None, fault=None):
        self.uid = uid
        self.records = records if records is not None else []
        self.fault = fault
        self.calls = []

    def __call__(self, url):
        self.url = url
        return self

    def authenticate(self, database, login, password, context):
        self.calls.append(("authenticate", database, login))
        return self.uid

    def execute_kw(self, database, uid, password, model, method, args, kwargs):
        if self.fault:
            raise self.fault
        self.calls.append((model, method, args, kwargs))
        return self.records


class ParseBackupKeyTests(unittest.TestCase):
    def test_reads_project_branch_and_database_like_brainkeys(self):
        self.assertEqual(remote_backups.parse_backup_key(KEY), ("client_a", "main", "client_a_prod__2026-10-22"))

    def test_ignores_folder_prefix(self):
        self.assertEqual(remote_backups.parse_backup_key("2026/10/" + KEY)[0], "client_a")

    def test_rejects_unexpected_names(self):
        self.assertIsNone(remote_backups.parse_backup_key("backup.zip"))
        self.assertIsNone(remote_backups.parse_backup_key("a__b__c__d__e"))


class SignRequestTests(unittest.TestCase):
    def test_matches_aws_documented_list_objects_example(self):
        # Exemple « GET Bucket (List Objects) » de la documentation Signature Version 4 d'Amazon S3.
        headers = remote_backups.sign_request(
            "GET",
            "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "us-east-1",
            now=datetime(2013, 5, 24, tzinfo=UTC),
        )
        self.assertTrue(
            headers["authorization"].endswith(
                "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"
            )
        )
        self.assertIn("SignedHeaders=host;x-amz-content-sha256;x-amz-date", headers["authorization"])


class FetchBackupAccessesTests(unittest.TestCase):
    def test_returns_accesses_of_records_shared_with_the_user(self):
        proxy = FakeProxy(
            records=[
                {"url": "https://s3.example.test", "token": "AK", "secret": "SK"},
                {"url": "", "token": "AK", "secret": "SK"},
            ]
        )
        accesses = remote_backups.fetch_backup_accesses("dev@sudokeys.com", "pwd", proxy=proxy)
        self.assertEqual(accesses, [S3Access("https://s3.example.test", "AK", "SK")])
        model, method, args, _kwargs = proxy.calls[1]
        self.assertEqual((model, method, args), ("sudokeys.dev.backup", "search_read", [[("user_ids", "in", [7])]]))

    def test_refused_login_is_explained(self):
        with self.assertRaisesRegex(RemoteBackupError, "refusé"):
            remote_backups.fetch_backup_accesses("dev", "bad", proxy=FakeProxy(uid=False))

    def test_account_without_backups_is_explained(self):
        with self.assertRaisesRegex(RemoteBackupError, "aucune sauvegarde"):
            remote_backups.fetch_backup_accesses("dev", "pwd", proxy=FakeProxy(records=[]))

    def test_odoo_fault_becomes_readable_error(self):
        fault = xmlrpc.client.Fault(1, "Access Denied")
        with self.assertRaisesRegex(RemoteBackupError, "Access Denied"):
            remote_backups.fetch_backup_accesses("dev", "pwd", proxy=FakeProxy(fault=fault))


def list_xml(keys, token=""):
    contents = "".join(
        f"<Contents><Key>{key}</Key><Size>{size}</Size><LastModified>{date}</LastModified></Contents>"
        for key, size, date in keys
    )
    truncated = (
        f"<IsTruncated>true</IsTruncated><NextContinuationToken>{token}</NextContinuationToken>" if token else ""
    )
    return (
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
        + contents
        + truncated
        + "</ListBucketResult>"
    ).encode()


class FakeS3:
    """Stockage S3 minimal servi à S3Client à la place du réseau."""

    def __init__(self, pages, objects=None, path_style=True):
        self.pages = pages
        self.objects = objects or {}
        self.path_style = path_style
        self.requests = []

    def __call__(self, request, timeout):
        url = urllib.parse.urlsplit(request.full_url)
        self.requests.append(request)
        query = dict(urllib.parse.parse_qsl(url.query))
        if url.path == "/" and url.netloc == "s3.example.test" and not query:
            return FakeResponse(
                b'<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                b"<Buckets><Bucket><Name>backups</Name></Bucket></Buckets></ListAllMyBucketsResult>"
            )
        if self.path_style and not url.path.startswith("/backups"):
            raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, io.BytesIO(b""))
        if not self.path_style and url.netloc != "backups.s3.example.test":
            raise urllib.error.HTTPError(
                request.full_url, 404, "Not Found", {}, io.BytesIO(b"<Error><Code>NoSuchBucket</Code></Error>")
            )
        if query.get("list-type") == "2":
            return FakeResponse(self.pages[query.get("continuation-token", "")])
        return FakeResponse(self.objects[url.path.rsplit("/", 1)[-1]])


class ListBackupsTests(unittest.TestCase):
    def test_lists_every_page_newest_first_and_counts_unexpected_names(self):
        older = KEY.replace("2026-10-22", "2026-10-21")
        s3 = FakeS3(
            {
                "": list_xml([(older, 10, "2026-10-21T03:00:00.000Z"), ("notes.txt", 1, "2026-10-01")], token="p2"),
                "p2": list_xml([(KEY, 20, "2026-10-22T03:00:00.000Z")]),
            }
        )
        backups, ignored = remote_backups.list_backups([ACCESS], client_factory=lambda access: S3Client(access, s3))
        self.assertEqual([backup.key for backup in backups], [KEY, older])
        self.assertEqual(ignored, 1)
        self.assertEqual(backups[0].to_payload()["project"], "client_a")
        self.assertNotIn("secret", str(backups[0].to_payload()))

    def test_falls_back_to_bucket_in_host_name(self):
        s3 = FakeS3({"": list_xml([(KEY, 20, "2026-10-22")])}, path_style=False)
        backups, _ignored = remote_backups.list_backups([ACCESS], client_factory=lambda access: S3Client(access, s3))
        self.assertEqual(len(backups), 1)

    def test_retries_with_region_given_by_storage(self):
        calls = []

        def opener(request, timeout):
            calls.append(request.headers["Authorization"])
            if len(calls) == 1:
                body = b"<Error><Code>AuthorizationHeaderMalformed</Code><Region>eu-west-3</Region></Error>"
                raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, io.BytesIO(body))
            return FakeResponse(b"<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>")

        client = S3Client(ACCESS, opener)
        self.assertEqual(client.list_buckets(), [])
        self.assertIn("/eu-west-3/s3/", calls[1])


class FlakyClient:
    """Coupe la connexion après `cut` octets lors du premier envoi."""

    def __init__(self, data, cut, honour_range=True):
        self.data = data
        self.cut = cut
        self.honour_range = honour_range
        self.starts = []

    def open_object(self, bucket, key, start=0):
        self.starts.append(start)
        if start and self.honour_range:
            return FakeResponse(
                self.data[start:], {"Content-Range": f"bytes {start}-{len(self.data) - 1}/{len(self.data)}"}
            )
        if len(self.starts) == 1:
            client = self

            class Cut(FakeResponse):
                def read(self, size=-1):
                    if self.tell() >= client.cut:
                        raise ConnectionResetError("reset")
                    return super().read(min(size, client.cut - self.tell()))

            return Cut(self.data)
        return FakeResponse(self.data)


def backup(size):
    return RemoteBackup(ACCESS, "backups", KEY, size, "2026-10-22", "client_a", "main", "db")


class DownloadBackupTests(unittest.TestCase):
    def test_resumes_where_the_connection_dropped(self):
        data = bytes(range(256)) * 40
        client = FlakyClient(data, cut=3000)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "backup.zip"
            progress = []
            remote_backups.download_backup(
                backup(len(data)), target, client=client, on_progress=lambda done, total: progress.append(done)
            )
            self.assertEqual(target.read_bytes(), data)
        self.assertEqual(client.starts, [0, 3000])
        self.assertEqual(progress[-1], len(data))

    def test_restarts_from_scratch_when_storage_ignores_resume(self):
        data = b"x" * 5000
        client = FlakyClient(data, cut=1000, honour_range=False)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "backup.zip"
            remote_backups.download_backup(backup(len(data)), target, client=client)
            self.assertEqual(target.read_bytes(), data)

    def test_access_refused_is_not_retried(self):
        class Refused:
            calls = 0

            def open_object(self, bucket, key, start=0):
                Refused.calls += 1
                raise remote_backups.S3Error("refusé", 403, "AccessDenied")

        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(RemoteBackupError):
            remote_backups.download_backup(backup(10), Path(tmp) / "b.zip", client=Refused())
        self.assertEqual(Refused.calls, 1)


if __name__ == "__main__":
    unittest.main()
