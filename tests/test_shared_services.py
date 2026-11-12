import unittest

from odoo_manager_core import mailpit, mobile_access


class MailpitRecipeTests(unittest.TestCase):
    def test_status_message_follows_the_container_and_traefik(self):
        self.assertIn("arrivent ici", mailpit.status_message("running", False))
        self.assertIn("Traefik", mailpit.status_message("absent", False))
        self.assertIn("Installe", mailpit.status_message("absent", True))
        self.assertIn("arrêté", mailpit.status_message("exited", True))


class MobileAccessRecipeTests(unittest.TestCase):
    def test_relay_is_published_on_the_wifi_address_only(self):
        arguments = mobile_access.run_arguments("DEMO", "192.168.1.20", "traefik-local")
        self.assertIn("192.168.1.20:8069:8069", arguments)
        self.assertIn("odoo-manager.mobile.url=http://192.168.1.20:8069/", arguments)
        self.assertIn(f"odoo-manager.mobile.recipe={mobile_access.RECIPE}", arguments)

    def test_relay_closes_database_management_and_targets_the_project(self):
        conf = mobile_access.nginx_conf("Caritel_v18")
        self.assertIn("set $odoo http://odoo-Caritel_v18:8069;", conf)
        self.assertIn("listen 8069;", conf)
        self.assertIn("location ~* ^/(web/database/|jsonrpc|xmlrpc) {", conf)
        self.assertNotIn("PROJECT", conf)

    def test_owner_is_read_back_or_left_empty(self):
        owner = mobile_access.parse_owner(0, "DEMO|http://1.2.3.4:8069/|abc\n")
        self.assertEqual(("DEMO", "http://1.2.3.4:8069/", "abc"), owner)
        self.assertEqual(("", "", ""), mobile_access.parse_owner(1, "DEMO|x|y"))
        # Relais d'avant la recette : deux étiquettes seulement, il sera refait.
        self.assertEqual(("", "", ""), mobile_access.parse_owner(0, "DEMO|x"))


class ProjectFoldersFromContainersTests(unittest.TestCase):
    def test_keeps_odoo_project_parents_outside_the_workspace(self):
        import tempfile
        from pathlib import Path

        from odoo_manager_core.project_service import project_folders_from_containers

        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            for project in ("elsewhere/demo", "workspace/known", "gone/old"):
                (root / project).mkdir(parents=True)
            (root / "elsewhere/demo/docker-compose.yml").write_text("services: {}\n")
            (root / "workspace/known/docker-compose.yml").write_text("services: {}\n")
            output = "\n".join(
                (
                    f"odoo-demo odoo:17\t{root}/elsewhere/demo",
                    f"postgresql-demo postgres:16\t{root}/elsewhere/demo",
                    f"odoo-known odoo:17\t{root}/workspace/known",
                    f"odoo-old odoo:16\t{root}/gone/old",
                    f"redis redis:7\t{root}/elsewhere/cache",
                )
            )
            self.assertEqual(
                project_folders_from_containers(output, root / "workspace"),
                [str(root / "elsewhere")],
            )


if __name__ == "__main__":
    unittest.main()
