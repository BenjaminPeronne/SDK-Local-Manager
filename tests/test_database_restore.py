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

        self.assertEqual({"pg_trgm": "", "vector": ""}, extensions)
        self.assertNotIn(b"COMMENT ON EXTENSION", prologue)
        self.assertIn(b"CREATE EXTENSION IF NOT EXISTS vector", prologue)
        # Rien n'est perdu entre le prologue et la suite, même coupé au milieu d'une ligne.
        remaining = b"".join(iter(lambda: read(7), b""))
        self.assertEqual(DUMP_BODY, rest + remaining)

    def test_extensions_keep_the_schema_odoo_sh_gives_them(self):
        dump = (
            b"CREATE SCHEMA unaccent_schema;\n"
            b"CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA unaccent_schema;\n"
            b"CREATE FUNCTION public.unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE\n"
            b"    AS $_$ SELECT unaccent_schema.unaccent('unaccent_schema.unaccent', $1) $_$;\n"
        ) + DUMP_BODY

        prologue, _rest, extensions = database_restore.split_prologue(chunked_reader(dump, 64), chunk_size=64)

        self.assertEqual({"unaccent": "unaccent_schema"}, extensions)
        # Le gestionnaire crée le schéma avec l'extension, avant le chargement du dump.
        self.assertTrue(prologue.startswith(b"CREATE SCHEMA IF NOT EXISTS unaccent_schema;\n"))

    def test_returns_everything_read_when_no_table_appears_in_time(self):
        data = b"SELECT 1;\n" * 10

        prologue, rest, extensions = database_restore.split_prologue(chunked_reader(data, 4), max_bytes=8, chunk_size=4)

        self.assertEqual((b"", {}), (prologue, extensions))
        self.assertEqual(data[:8], rest)

    def test_streams_the_whole_dump_without_extension_comments(self):
        written = []
        post_data = []
        steps = []
        with tempfile.TemporaryDirectory() as temporary:
            with zipfile.ZipFile(make_backup(temporary)) as archive:
                dump, filestore = database_restore.backup_contents(archive)
                self.assertEqual({"pg_trgm": "", "vector": ""}, database_restore.dump_extensions(archive, dump))
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


class PostDataTests(unittest.TestCase):
    def split(self, dump, chunk_size):
        splitter = database_restore.DumpSplitter()
        sent = b"".join(splitter.feed(dump[index : index + chunk_size]) for index in range(0, len(dump), chunk_size))
        return sent + splitter.finish(), splitter

    def test_post_data_is_kept_aside_whatever_the_chunk_boundaries(self):
        for chunk_size in (1, 3, 7, 64, 4096):
            with self.subTest(chunk_size=chunk_size):
                sent, splitter = self.split(DUMP_PROLOGUE + DUMP_BODY, chunk_size)

                self.assertTrue(sent.endswith(b"1\tSudokeys\n\\.\n"))
                self.assertEqual(DUMP_PROLOGUE + DUMP_BODY, sent + bytes(splitter.post_data))
                self.assertTrue(splitter.post_data.startswith(b"ALTER TABLE ONLY public.res_partner\n"))

    def test_rows_that_look_like_statements_stay_in_their_copy_block(self):
        dump = (
            b"COPY public.note (body) FROM stdin;\n"
            b"CREATE INDEX not_an_index ON public.note (body);\n"
            b"\\.\n"
            b"COPY public.empty (id) FROM stdin;\n"
            b"\\.\n"
            b"CREATE INDEX note_body ON public.note USING btree (body);\n"
        )
        for chunk_size in (1, 5, 4096):
            with self.subTest(chunk_size=chunk_size):
                sent, splitter = self.split(dump, chunk_size)

                self.assertEqual(b"CREATE INDEX note_body ON public.note USING btree (body);\n", splitter.post_data)
                self.assertEqual(dump, sent + bytes(splitter.post_data))

    def test_frozen_copies_truncate_the_empty_table_in_the_same_transaction(self):
        splitter = database_restore.DumpSplitter(freeze=True)

        sent = splitter.feed(DUMP_PROLOGUE + DUMP_BODY[:120]) + splitter.feed(DUMP_BODY[120:]) + splitter.finish()

        self.assertIn(
            b"BEGIN;\nTRUNCATE ONLY public.res_partner;\n"
            b"COPY public.res_partner (id, name) FROM stdin WITH (FREEZE);\n1\tSudokeys\n\\.\nCOMMIT;\n",
            sent,
        )
        self.assertNotIn(b"FREEZE", bytes(splitter.post_data))

    def test_partitioned_tables_are_loaded_without_freeze(self):
        splitter = database_restore.DumpSplitter(freeze=True)
        dump = (
            b"CREATE TABLE public.log (id integer, date date)\nPARTITION BY RANGE (date);\n"
            b"COPY public.log_2026 (id, date) FROM stdin;\n1\t2026-01-01\n\\.\n"
        )

        sent = splitter.feed(dump) + splitter.finish()

        self.assertEqual(dump, sent)

    def test_an_oversized_post_data_goes_to_psql_with_the_rest(self):
        splitter = database_restore.DumpSplitter(max_post_data=40)
        dump = DUMP_PROLOGUE + DUMP_BODY

        sent = splitter.feed(dump) + splitter.feed(b"SELECT 1;\n" * 10) + splitter.finish()

        self.assertIsNone(splitter.post_data)
        self.assertEqual(dump + b"SELECT 1;\n" * 10, sent)

    def test_statements_ignore_semicolons_in_strings_bodies_and_comments(self):
        script = (
            "--\n-- Name: x; Type: VIEW\n--\n\n"
            "CREATE VIEW public.v AS SELECT ';' AS a, \"semi;colon\" FROM t;\n"
            "DO $$\nBEGIN\n    UPDATE t SET a = 1;\nEND;\n$$;\n"
            "CREATE FUNCTION f() RETURNS text AS $body$ SELECT 'a;b' $body$ LANGUAGE sql;\n"
            "\\unrestrict abc\n"
            "COMMENT ON TABLE t IS 'it''s; fine'"
        )

        self.assertEqual(
            [
                "CREATE VIEW public.v AS SELECT ';' AS a, \"semi;colon\" FROM t",
                "DO $$\nBEGIN\n    UPDATE t SET a = 1;\nEND;\n$$",
                "CREATE FUNCTION f() RETURNS text AS $body$ SELECT 'a;b' $body$ LANGUAGE sql",
                "\\unrestrict abc",
                "COMMENT ON TABLE t IS 'it''s; fine'",
            ],
            database_restore.split_sql_statements(script),
        )

    def test_post_data_steps_group_by_table_and_validate_foreign_keys_afterwards(self):
        statements = [
            "ALTER TABLE ONLY public.res_users\n    ADD CONSTRAINT res_users_login_key UNIQUE (login)",
            "COMMENT ON CONSTRAINT res_users_login_key ON public.res_users IS 'unique (login)'",
            "ALTER TABLE ONLY public.res_partner\n    ADD CONSTRAINT res_partner_pkey PRIMARY KEY (id)",
            "CREATE INDEX res_partner_name_index ON public.res_partner USING btree (name)",
            "COMMENT ON INDEX public.res_partner_name_index IS 'search'",
            "CREATE VIEW public.report AS SELECT 1",
            "ALTER TABLE ONLY public.res_partner\n    ADD CONSTRAINT res_partner_user_id_fkey FOREIGN KEY (user_id) "
            "REFERENCES public.res_users(id) ON DELETE SET NULL",
            "ALTER TABLE ONLY public.res_users\n    ADD CONSTRAINT res_users_partner_id_fkey FOREIGN KEY (partner_id) "
            "REFERENCES public.res_partner(id) NOT VALID",
            "\\unrestrict abc",
            "UPDATE ir_cron SET active = false",
        ]

        steps = database_restore.post_data_steps(statements)

        self.assertEqual([True, False, False, True, False], [step.parallel for step in steps])
        build = {task.table: task.statements for task in steps[0].tasks}
        self.assertEqual(statements[2:5], build["public.res_partner"])
        self.assertEqual(statements[:2], build["public.res_users"])
        self.assertEqual([statements[5]], steps[1].tasks[0].statements)
        # Clé étrangère déjà NOT VALID dans la base d'origine : créée telle quelle, jamais contrôlée.
        self.assertEqual([statements[6] + " NOT VALID", statements[7]], steps[2].tasks[0].statements)
        self.assertEqual(
            [["ALTER TABLE ONLY public.res_partner VALIDATE CONSTRAINT res_partner_user_id_fkey"]],
            [task.statements for task in steps[3].tasks],
        )
        self.assertEqual([statements[9]], steps[4].tasks[0].statements)
        self.assertEqual("UPDATE ir_cron SET active = false;\n", steps[4].tasks[0].script)


class OrderedPostDataTests(unittest.TestCase):
    def test_a_single_session_keeps_the_dump_order_in_tasks_per_table(self):
        statements = [
            "ALTER TABLE ONLY public.res_partner\n    ADD CONSTRAINT res_partner_pkey PRIMARY KEY (id)",
            "CREATE INDEX res_partner_name_index ON public.res_partner USING btree (name)",
            "ALTER TABLE ONLY public.res_users\n    ADD CONSTRAINT res_users_pkey PRIMARY KEY (id)",
            "CREATE VIEW public.report AS SELECT 1",
            "ALTER TABLE ONLY public.res_partner\n    ADD CONSTRAINT res_partner_user_id_fkey FOREIGN KEY (user_id) "
            "REFERENCES public.res_users(id)",
            "\\unrestrict abc",
        ]

        tasks = database_restore.ordered_post_data_tasks(statements)

        self.assertEqual(
            ["public.res_partner", "public.res_users", "", "public.res_partner"], [task.table for task in tasks]
        )
        # Rien n'est réordonné ni réécrit : la clé étrangère est contrôlée dès sa création.
        self.assertEqual(statements[:5], [statement for task in tasks for statement in task.statements])


class RestoreSqlTests(unittest.TestCase):
    def test_copy_gets_a_new_identity_like_odoo_does(self):
        sql = database_restore.copy_parameters_sql(
            now=datetime(2026, 10, 5, 21, 0, 0), database_uuid="new-uuid", database_secret="new'secret"
        )

        self.assertIn("SET value = 'new-uuid'", sql)
        self.assertIn("'new''secret'", sql)
        self.assertIn("'2026-10-05 21:00:00'", sql)
        self.assertIn("WHERE NOT EXISTS (SELECT 1 FROM ir_config_parameter WHERE key = 'database.uuid')", sql)
        self.assertNotIn("web.base.url", sql)

    def test_restored_database_links_point_to_the_project_address(self):
        sql = database_restore.restored_urls_sql("http://dev.client.localhost")

        self.assertIn("SET value = 'http://dev.client.localhost'", sql)
        self.assertIn("WHERE NOT EXISTS (SELECT 1 FROM ir_config_parameter WHERE key = 'web.base.url')", sql)
        # report.url n'est corrigé que s'il existe : sans lui, Odoo prend web.base.url.
        self.assertIn("SET value = 'http://127.0.0.1:8069'", sql)
        self.assertNotIn("SELECT 'report.url'", sql)

    def test_local_urls_only_replace_unreachable_addresses(self):
        sql = database_restore.local_urls_sql("http://dev.client_v19.localhost:8080")

        self.assertIn("SET value = 'http://dev.client_v19.localhost:8080'", sql)
        self.assertIn("'http://localhost:8069', 'http://localhost:8069/', 'http://127.0.0.1:8069'", sql)
        self.assertIn(r"value ~* '^https?://dev\.client_v19\.localhost(:[0-9]+)?/?$'", sql)
        self.assertIn("to_regclass('public.ir_config_parameter') IS NULL", sql)
        self.assertIn("value !~ ':8069/?$'", sql)
        self.assertTrue(sql.rstrip().endswith("FROM sdk_local_urls ORDER BY key;"))

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

    def test_parallel_sessions_share_memory_and_processes(self):
        options = database_restore.restore_session_options(
            140000, memory_bytes=4 * database_restore.GIB, cpus=6, sessions=3
        )

        self.assertIn("-c maintenance_work_mem=170MB", options)
        self.assertIn("-c max_parallel_maintenance_workers=1", options)
        self.assertEqual(3, database_restore.post_data_sessions(6))
        self.assertEqual(3, database_restore.post_data_sessions(16))
        self.assertEqual(1, database_restore.post_data_sessions(1))
        # Sous macOS, le partage de fichiers de Docker Desktop limite déjà une session seule.
        self.assertEqual(1, database_restore.post_data_sessions(8, shared_folder=True))

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
