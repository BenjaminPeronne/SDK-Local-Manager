import http.client
import io
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import odoo_manager_web as web
from odoo_manager_core.archives import save_multipart_upload

BOUNDARY = "----sdkBoundary7MA4YWxk"
CONTENT_TYPE = f"multipart/form-data; boundary={BOUNDARY}"


def form(*parts, epilogue=b""):
    """Corps multipart tel qu'un navigateur l'envoie : (nom, valeur) ou (nom, fichier, contenu)."""
    body = b""
    for part in parts:
        body += f"--{BOUNDARY}\r\n".encode()
        if len(part) == 2:
            name, value = part
            body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode() + value.encode() + b"\r\n"
        else:
            name, filename, content = part
            body += (
                (
                    f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                    "Content-Type: application/zip\r\n\r\n"
                ).encode()
                + content
                + b"\r\n"
            )
    return body + f"--{BOUNDARY}--\r\n".encode() + epilogue


def module_zip(*names):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in names:
            archive.writestr(f"addons/{name}/__manifest__.py", f"{{'name': '{name}'}}\n")
    return buffer.getvalue()


class SaveMultipartUploadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.destination = Path(self.temporary.name) / "upload.zip"

    def tearDown(self):
        self.temporary.cleanup()

    def save(self, body, chunk_size=1024 * 1024, file_field="zip"):
        stream = io.BytesIO(body)
        result = save_multipart_upload(
            stream, len(body), CONTENT_TYPE, self.destination, file_field, chunk_size=chunk_size
        )
        return result, stream

    def test_file_and_fields_are_split_even_when_a_delimiter_straddles_two_reads(self):
        # Contenu binaire qui ressemble au délimiteur sans l'être : il ne doit pas couper le fichier.
        content = b"PK\x03\x04" + b"\r\n--" + BOUNDARY[:-1].encode() + bytes(range(256)) * 50
        body = form(("replace_existing", "1"), ("zip", "../../modules.zip", content), ("modules", "a,b"))
        for chunk_size in (1, 7, 64, 1024 * 1024):
            with self.subTest(chunk_size=chunk_size):
                (fields, filename), stream = self.save(body, chunk_size=chunk_size)
                self.assertEqual({"replace_existing": "1", "modules": "a,b"}, fields)
                self.assertEqual("modules.zip", filename)
                self.assertEqual(content, self.destination.read_bytes())
                self.assertEqual(len(body), stream.tell())

    def test_other_files_are_ignored_and_a_missing_file_is_reported(self):
        (fields, filename), _stream = self.save(form(("other", "a.zip", b"ignored"), ("note", "x")))
        self.assertIsNone(filename)
        self.assertEqual({"note": "x"}, fields)
        self.assertFalse(self.destination.exists())

    def test_the_epilogue_is_read_so_the_connection_stays_usable(self):
        body = form(("zip", "m.zip", b"data"), epilogue=b"trailing bytes after the form")
        (_fields, filename), stream = self.save(body, chunk_size=5)
        self.assertEqual("m.zip", filename)
        self.assertEqual(len(body), stream.tell())

    def test_an_oversized_text_field_is_refused_after_reading_the_whole_body(self):
        body = form(("modules", "x" * (70 * 1024)), ("zip", "m.zip", b"data"))
        stream = io.BytesIO(body)
        with self.assertRaisesRegex(ValueError, "trop volumineux"):
            save_multipart_upload(stream, len(body), CONTENT_TYPE, self.destination, "zip", chunk_size=4096)
        self.assertEqual(len(body), stream.tell())

    def test_truncated_or_malformed_bodies_are_refused(self):
        body = form(("zip", "m.zip", b"data"))
        with self.assertRaisesRegex(ValueError, "interrompu"):
            save_multipart_upload(io.BytesIO(body[:-20]), len(body), CONTENT_TYPE, self.destination, "zip")
        with self.assertRaisesRegex(ValueError, "Boundary"):
            save_multipart_upload(io.BytesIO(body), len(body), "multipart/form-data", self.destination, "zip")
        garbage = b"no multipart here"
        with self.assertRaisesRegex(ValueError, "illisible"):
            save_multipart_upload(io.BytesIO(garbage), len(garbage), CONTENT_TYPE, self.destination, "zip")


class ModuleZipUploadEndpointTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.project = "TEST_PROJECT"
        (self.root / self.project / "odoo" / "addons").mkdir(parents=True)
        (self.root / self.project / "odoo" / "addons-store").mkdir(parents=True)
        (self.root / self.project / "compose.yml").write_text("services: {}\n", encoding="utf-8")
        self.patches = [
            patch.object(web, "WORKSPACE", self.root),
            patch.object(web, "API_TOKEN", ""),
            patch.object(web, "ERROR_LOG_PATH", self.root / "errors.jsonl"),
        ]
        for active in self.patches:
            active.start()
        self.server = web.ManagerHTTPServer(("127.0.0.1", 0), web.Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        for active in reversed(self.patches):
            active.stop()
        self.temporary.cleanup()

    def post(self, path, body):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request(
            "POST",
            path,
            body=body,
            headers={"Host": f"127.0.0.1:{self.port}", "Content-Type": CONTENT_TYPE},
        )
        response = connection.getresponse()
        payload = json.loads(response.read() or b"{}")
        connection.close()
        return response.status, payload

    def staged_uploads(self):
        return list(web.project_staging_imports_root(self.project).glob(".upload-*"))

    def test_inspection_reads_the_zip_from_disk_and_leaves_nothing_behind(self):
        body = form(("zip", "addons.zip", module_zip("sale_extra", "stock_extra")))
        status, payload = self.post(f"/api/projects/{self.project}/module-zip/inspect", body)
        self.assertEqual(200, status, payload)
        self.assertEqual(["sale_extra", "stock_extra"], payload["modules"])
        self.assertEqual([], self.staged_uploads())

    def test_import_hands_the_received_file_to_the_action_instead_of_its_bytes(self):
        created = []

        class FakeJob:
            def __init__(self, title, target, args, project=None):
                created.append(args)

        with (
            patch.object(web, "Job", FakeJob),
            patch.object(web, "job_creation_payload", return_value={"id": 1}),
        ):
            body = form(("replace_existing", "1"), ("zip", "addons.zip", module_zip("sale_extra")))
            status, payload = self.post(f"/api/projects/{self.project}/module-zip", body)
        self.assertEqual(201, status, payload)
        project, filename, upload, replace_existing, _selected = created[0]
        self.assertEqual((self.project, "addons.zip", True), (project, filename, replace_existing))
        self.assertIsInstance(upload, Path)
        self.assertTrue(zipfile.is_zipfile(upload))

    def test_a_refused_form_removes_the_received_file(self):
        body = form(("zip", "addons.zip", module_zip("sale_extra")), ("modules", "bad name!"))
        status, payload = self.post(f"/api/projects/{self.project}/module-zip", body)
        self.assertEqual(400, status)
        self.assertNotIn("Projet introuvable", payload["error"])
        self.assertEqual([], self.staged_uploads())


if __name__ == "__main__":
    unittest.main()
