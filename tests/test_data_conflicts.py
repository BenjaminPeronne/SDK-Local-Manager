import unittest

from odoo_manager_core import data_conflicts

# Extrait du journal de `-u all` sur mabonneetoile_06102026 (Odoo 16) : cantons suisses créés à la main.
UPDATE_LOG = """2026-10-06 11:41:25,262 697 INFO ? odoo: addons paths: ['/home/odoo/srv/server/odoo/odoo/addons', '/home/odoo/srv/data/addons/16.0', '/home/odoo/srv/server/addons', '/home/odoo/srv/server/odoo/addons']
2026-10-06 11:41:26,671 697 INFO mabonneetoile_06102026 odoo.modules.loading: loading base/views/res_config_views.xml
2026-10-06 11:41:26,676 697 INFO mabonneetoile_06102026 odoo.modules.loading: loading base/data/res.country.state.csv
2026-10-06 11:41:26,974 697 ERROR mabonneetoile_06102026 odoo.sql_db: bad query: INSERT INTO "res_country_state" ("code", "country_id", "create_date", "create_uid", "name", "write_date", "write_uid") VALUES ('ZH', 43, '2026-10-06 11:41:25.644295', 1, 'Zürich', '2026-10-06 11:41:25.644295', 1) RETURNING "id"
ERROR: duplicate key value violates unique constraint "res_country_state_name_code_uniq"
DETAIL:  Key (country_id, code)=(43, ZH) already exists.

2026-10-06 11:41:27,797 697 ERROR mabonneetoile_06102026 odoo.modules.registry: Failed to load registry
Exception: Module loading base failed: file base/data/res.country.state.csv could not be processed:
"""

STATES_CSV = """"id","country_id:id","name","code"
state_nl_zh,nl,"Zuid-Holland","ZH"
state_ch_zh,ch,"Zürich","ZH"
state_ch_be,ch,"Bern","BE"
broken_line_without_columns
"""

PARAMETERS_XML = """<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data noupdate="1">
        <record id="default_peppol_mode" model="ir.config_parameter">
            <field name="key">account_peppol.edi.mode</field>
            <field name="value">demo</field>
        </record>
        <record id="computed_key" model="ir.config_parameter">
            <field name="key" eval="'x' + 'y'"/>
        </record>
    </data>
    <record id="mail_server" model="ir.mail_server">
        <field name="name">Main</field>
        <field name="active" eval="True"/>
        <field name="company_id" ref="base.main_company"/>
    </record>
</odoo>
"""


class FindDataConflictTests(unittest.TestCase):
    def test_reads_the_loaded_file_the_table_and_the_duplicate_key(self):
        conflict = data_conflicts.find_data_conflict(UPDATE_LOG)

        self.assertEqual(("base", "data/res.country.state.csv"), (conflict.module, conflict.path))
        self.assertEqual(("res_country_state", ("country_id", "code")), (conflict.table, conflict.columns))
        self.assertEqual("res_country_state (country_id, code) = (43, ZH)", conflict.describe())
        self.assertEqual(
            ["/home/odoo/srv/server/odoo/odoo/addons", "/home/odoo/srv/data/addons/16.0"],
            data_conflicts.addons_paths(UPDATE_LOG)[:2],
        )

    def test_other_failures_are_not_data_conflicts(self):
        self.assertIsNone(data_conflicts.find_data_conflict("ModuleNotFoundError: No module named 'openai'"))
        # Doublon sans fichier de données en cours de chargement : rien à rapprocher.
        self.assertIsNone(
            data_conflicts.find_data_conflict(
                'INSERT INTO "x" ERROR: duplicate key value violates unique constraint "x_uniq"\n'
                "DETAIL:  Key (code)=(A) already exists."
            )
        )


class DataRecordsTests(unittest.TestCase):
    def test_csv_rows_carry_the_qualified_xmlid_and_the_key_values(self):
        conflict = data_conflicts.DataConflict(
            "base", "data/res.country.state.csv", "res_country_state", ("country_id", "code"), "43, ZH"
        )

        model, records = data_conflicts.data_records(conflict, STATES_CSV)

        self.assertEqual("res.country.state", model)
        self.assertEqual(
            [
                ("base.state_nl_zh", (("base.nl", True), ("ZH", False))),
                ("base.state_ch_zh", (("base.ch", True), ("ZH", False))),
                ("base.state_ch_be", (("base.ch", True), ("BE", False))),
            ],
            [(record.xmlid, record.values) for record in records],
        )

    def test_xml_records_keep_noupdate_and_skip_computed_values(self):
        conflict = data_conflicts.DataConflict(
            "account_peppol", "demo/account_peppol_demo.xml", "ir_config_parameter", ("key",), "account_peppol.edi.mode"
        )

        model, records = data_conflicts.data_records(conflict, PARAMETERS_XML)

        self.assertEqual("ir.config_parameter", model)
        self.assertEqual(
            [("account_peppol.default_peppol_mode", (("account_peppol.edi.mode", False),), True)],
            [(record.xmlid, record.values, record.noupdate) for record in records],
        )

    def test_xml_model_comes_from_the_file_not_from_the_table_name(self):
        conflict = data_conflicts.DataConflict(
            "base", "data/mail.xml", "ir_mail_server", ("company_id", "active"), "1, true"
        )

        model, records = data_conflicts.data_records(conflict, PARAMETERS_XML)

        self.assertEqual("ir.mail_server", model)
        self.assertEqual((("base.main_company", True), ("true", False)), records[0].values)

    def test_a_csv_of_another_model_is_ignored(self):
        conflict = data_conflicts.DataConflict("base", "data/res.lang.csv", "res_country_state", ("code",), "ZH")

        self.assertEqual(("", []), data_conflicts.data_records(conflict, STATES_CSV))


class AdoptionSqlTests(unittest.TestCase):
    def test_sql_links_existing_rows_without_this_module_xmlid(self):
        conflict = data_conflicts.DataConflict(
            "base", "data/res.country.state.csv", "res_country_state", ("country_id", "code"), "43, ZH"
        )
        _model, records = data_conflicts.data_records(conflict, STATES_CSV)

        sql = data_conflicts.adoption_sql(
            conflict, "res.country.state", records, {"country_id": "integer", "code": "character varying"}
        )

        self.assertIn("('base', 'state_ch_zh', false, 'base.ch', 'ZH')", sql)
        self.assertIn('t."country_id" = r.k0 AND t."code"::text = r.k1', sql)
        self.assertIn("d.model = 'res.country.state' AND d.res_id = t.id AND d.module = r.xmlid_module", sql)
        self.assertIn("RETURNING module || '.' || name", sql)

    def test_translated_columns_compare_their_english_value(self):
        conflict = data_conflicts.DataConflict("base", "data/x.xml", "res_partner_title", ("name",), "Madam")
        records = [data_conflicts.DataRecord("base.res_partner_title_madam", (("Madam", False),), False)]

        sql = data_conflicts.adoption_sql(conflict, "res.partner.title", records, {"name": "jsonb"})

        self.assertIn("""t."name"->>'en_US' = r.k0""", sql)
        self.assertEqual("", data_conflicts.adoption_sql(conflict, "res.partner.title", [], {"name": "jsonb"}))


if __name__ == "__main__":
    unittest.main()
