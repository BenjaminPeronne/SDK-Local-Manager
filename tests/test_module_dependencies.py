import unittest

from odoo_manager_core.module_dependencies import dependency_report


def graph(**modules):
    return {name: {"depends": list(depends), "installable": True} for name, depends in modules.items()}


INSTALLED = {"state": "installed"}


class DependencyReportTests(unittest.TestCase):
    def test_a_present_module_with_a_missing_dependency_is_not_loaded(self):
        # Cas EMPH : emph_base est présent, mais product_sequence n'a pas de code.
        report = dependency_report(
            graph(base=[], sale=["base"], emph_base=["sale", "product_sequence"]),
            {"base": INSTALLED, "sale": INSTALLED, "emph_base": INSTALLED, "product_sequence": INSTALLED},
        )

        self.assertFalse(report["ok"])
        self.assertEqual(["product_sequence"], [row["name"] for row in report["missing"]])
        self.assertEqual(["emph_base"], report["missing"][0]["required_by"])
        self.assertEqual(
            [{"name": "emph_base", "blocked_by": ["product_sequence"], "root_causes": ["product_sequence"]}],
            report["not_loaded"],
        )

    def test_the_cascade_follows_indirect_dependencies_to_the_root_cause(self):
        report = dependency_report(
            graph(base=[], middle=["base", "gone"], top=["middle"]),
            {"base": INSTALLED, "middle": INSTALLED, "top": INSTALLED, "gone": INSTALLED},
        )

        top = next(row for row in report["not_loaded"] if row["name"] == "top")
        self.assertEqual(["middle"], top["blocked_by"])
        self.assertEqual(["gone"], top["root_causes"])

    def test_a_non_installable_manifest_counts_as_missing(self):
        modules = graph(base=[], old=["base"])
        modules["old"]["installable"] = False

        report = dependency_report(modules, {"base": INSTALLED, "old": INSTALLED})

        self.assertEqual([("old", "non installable")], [(row["name"], row["reason"]) for row in report["missing"]])

    def test_a_dependency_absent_from_code_and_database_is_reported(self):
        report = dependency_report(graph(base=[], custom=["base", "nowhere"]), {"base": INSTALLED, "custom": INSTALLED})

        self.assertEqual(["nowhere"], [row["name"] for row in report["missing"]])
        self.assertEqual("absent de la base", report["missing"][0]["state"])
        self.assertEqual(["custom"], [row["name"] for row in report["not_loaded"]])

    def test_uninstalled_modules_database_only_modules_and_exclusions(self):
        report = dependency_report(
            graph(base=[]),
            {
                "base": INSTALLED,
                "never_installed": {"state": "uninstalled"},
                "studio_customization": INSTALLED,
                "excluded_one": INSTALLED,
            },
            excluded={"excluded_one"},
            database_only={"studio_customization"},
        )

        self.assertEqual([("excluded_one", True)], [(row["name"], row["excluded"]) for row in report["missing"]])

    def test_a_complete_database_is_ok(self):
        report = dependency_report(graph(base=[], sale=["base"]), {"base": INSTALLED, "sale": INSTALLED})

        self.assertEqual({"ok": True, "missing": [], "not_loaded": []}, report)


if __name__ == "__main__":
    unittest.main()
