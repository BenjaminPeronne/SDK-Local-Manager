import io
import tarfile
import tempfile
import unittest
import zipfile
from datetime import datetime
from pathlib import Path

from odoo_manager_core import database_restore
from odoo_manager_core.manifests import manifest_graph_entry

# Début d'un dump.sql produit par pg_dump --no-owner (sauvegarde ZIP d'Odoo).
DUMP_PROLOGUE = (
    b"SET statement_timeout = 0;\n"
    b"SELECT pg_catalog.set_config('search_path', '', false);\n"
    b"CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;\n"
    b"COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement';\n"
    b"CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;\n"
    b"COMMENT ON EXTENSION vector IS 'vector data type';\n"
)
DUMP_BODY = (
    b"CREATE TABLE public.res_partner (id integer NOT NULL, name character varying);\n"
    b"COPY public.res_partner (id, name) FROM stdin;\n"
    b"1\tSudokeys\n"
    b"\\.\n"
    b"ALTER TABLE ONLY public.res_partner\n"
    b"    ADD CONSTRAINT res_partner_pkey PRIMARY KEY (id);\n"
    b"CREATE INDEX res_partner_name_index ON public.res_partner USING btree (name);\n"
)


def chunked_reader(data, size):
    stream = io.BytesIO(data)
    return lambda _requested: stream.read(size)


def make_backup(root, dump=DUMP_PROLOGUE + DUMP_BODY, filestore=None):
    path = Path(root) / "backup.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("dump.sql", dump)
        archive.writestr("manifest.json", '{"version": "16.0"}')
        for name, content in (filestore or {}).items():
            archive.writestr(f"filestore/{name}", content)
    return path


class DumpPrologueTests(unittest.TestCase):
    def test_reads_extensions_until_the_first_table_and_drops_their_comments(self):
        read = chunked_reader(DUMP_PROLOGUE + DUMP_BODY, 7)
        prologue, rest, extensions = database_restore.split_prologue(read, chunk_size=7)

        self.assertEqual(["pg_trgm", "vector"], extensions)
        self.assertNotIn(b"COMMENT ON EXTENSION", prologue)
        self.assertIn(b"CREATE EXTENSION IF NOT EXISTS vector", prologue)
        # Rien n'est perdu entre le prologue et la suite, même coupé au milieu d'une ligne.
        remaining = b"".join(iter(lambda: read(7), b""))
        self.assertEqual(DUMP_BODY, rest + remaining)

    def test_returns_everything_read_when_no_table_appears_in_time(self):
        data = b"SELECT 1;\n" * 10

        prologue, rest, extensions = database_restore.split_prologue(chunked_reader(data, 4), max_bytes=8, chunk_size=4)

        self.assertEqual((b"", []), (prologue, extensions))
        self.assertEqual(data[:8], rest)

    def test_streams_the_whole_dump_without_extension_comments(self):
        written = []
        post_data = []
        steps = []
        with tempfile.TemporaryDirectory() as temporary:
            with zipfile.ZipFile(make_backup(temporary)) as archive:
                dump, filestore = database_restore.backup_contents(archive)
                self.assertEqual(["pg_trgm", "vector"], database_restore.dump_extensions(archive, dump))
                progress = database_restore.DumpProgress(
                    dump.file_size,
                    on_progress=lambda _sent, _total, step: steps.append(step),
                    on_post_data=lambda: post_data.append(True),
                )
                database_restore.stream_dump(archive, dump, written.append, progress, read_size=16)

        sent = b"".join(written)
        self.assertEqual([], filestore)
        expected_prologue = b"".join(line for line in DUMP_PROLOGUE.splitlines(True) if b"COMMENT ON" not in line)
        self.assertEqual(expected_prologue + DUMP_BODY, sent)
        self.assertEqual([True], post_data)
        reported = [step for step in steps if step is not None]
        self.assertTrue(reported and reported == sorted(reported))


class RestoreSqlTests(unittest.TestCase):
    def test_copy_gets_a_new_identity_like_odoo_does(self):
        sql = database_restore.copy_parameters_sql(
            now=datetime(2026, 10, 5, 21, 0, 0), database_uuid="new-uuid", database_secret="new'secret"
        )

        self.assertIn("SET value = 'new-uuid'", sql)
        self.assertIn("'new''secret'", sql)
        self.assertIn("'2026-10-05 21:00:00'", sql)
        self.assertIn("WHERE NOT EXISTS (SELECT 1 FROM ir_config_parameter WHERE key = 'web.base.url')", sql)

    def test_empty_database_matches_odoo_and_quotes_names(self):
        self.assertEqual(
            'CREATE DATABASE "client""v16" OWNER "odoo" ENCODING \'unicode\' LC_COLLATE \'C\' TEMPLATE template0;',
            database_restore.create_database_sql('client"v16', "odoo"),
        )

    def test_session_options_follow_docker_memory_and_postgres_version(self):
        options = database_restore.restore_session_options(140000, memory_bytes=4 * database_restore.GIB, cpus=6)

        self.assertIn("-c maintenance_work_mem=512MB", options)
        self.assertIn("-c synchronous_commit=off", options)
        self.assertIn("-c max_parallel_maintenance_workers=3", options)
        # PostgreSQL 10 refuserait la connexion sur un paramètre inconnu.
        self.assertNotIn("parallel", database_restore.restore_session_options(100000, 0, 8))
        self.assertIn("maintenance_work_mem=256MB", database_restore.restore_session_options(100000, 0, 8))

    def test_disk_space_needed_and_df_output(self):
        database, files = database_restore.space_needed(10 * database_restore.GIB, 0)

        self.assertEqual(int(7 * database_restore.GIB) + 2 * database_restore.GIB, database)
        self.assertEqual(0, files)
        df = "Filesystem 1024-blocks Used Available Capacity Mounted on\nvirtiofs0 972 900 16777216 99% /data\n"
        self.assertEqual(16 * database_restore.GIB, database_restore.parse_df_available(df))
        self.assertIsNone(database_restore.parse_df_available("df: /data: No such file"))
        self.assertEqual("16,0 Go", database_restore.format_bytes(16 * database_restore.GIB))


class FilestoreTarTests(unittest.TestCase):
    def test_filestore_is_streamed_as_tar_relative_to_the_database_folder(self):
        output = io.BytesIO()
        with tempfile.TemporaryDirectory() as temporary:
            path = make_backup(temporary, filestore={"ab/abcdef": b"attachment", "cd/cdef01": b"other"})
            with zipfile.ZipFile(path) as archive:
                _dump, filestore = database_restore.backup_contents(archive)
                database_restore.write_filestore_tar(archive, filestore, output)

        output.seek(0)
        with tarfile.open(fileobj=output, mode="r|") as tar:
            files = {member.name: tar.extractfile(member).read() for member in tar}
        self.assertEqual({"ab/abcdef": b"attachment", "cd/cdef01": b"other"}, files)


class PsqlErrorsTests(unittest.TestCase):
    def test_keeps_errors_with_their_detail_up_to_the_limit(self):
        logged = []
        errors = database_restore.PsqlErrors(log=logged.append)
        errors.add("psql:<stdin>:12: NOTICE ignored before any error")
        errors.add('psql:<stdin>:40: ERROR:  type "vector" does not exist')
        errors.add("LINE 3:     embedding public.vector(1536)")
        for index in range(database_restore.PsqlErrors.LIMIT + 2):
            errors.add(f"psql:<stdin>:{index}: ERROR:  relation missing")

        self.assertEqual(database_restore.PsqlErrors.LIMIT + 3, errors.count)
        self.assertEqual('psql : psql:<stdin>:40: ERROR:  type "vector" does not exist', logged[0])
        self.assertIn("LINE 3", logged[1])
        self.assertEqual(database_restore.PsqlErrors.LIMIT + 1, len(logged))


class ManifestPythonDependenciesTests(unittest.TestCase):
    def test_graph_keeps_the_python_packages_a_module_declares(self):
        entry = manifest_graph_entry(
            {"depends": ["mail"], "external_dependencies": {"python": ["openai", " ", 3, "bad name"], "bin": ["x"]}}
        )

        self.assertEqual(["openai"], entry["python_dependencies"])
        self.assertEqual([], manifest_graph_entry({"external_dependencies": "openai"})["python_dependencies"])


if __name__ == "__main__":
    unittest.main()
