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
        self.assertEqual("TCP:odoo-DEMO:8069", arguments[-1])

    def test_owner_is_read_back_or_left_empty(self):
        self.assertEqual(("DEMO", "http://1.2.3.4:8069/"), mobile_access.parse_owner(0, "DEMO|http://1.2.3.4:8069/\n"))
        self.assertEqual(("", ""), mobile_access.parse_owner(1, "DEMO|x"))
        self.assertEqual(("", ""), mobile_access.parse_owner(0, "No such object"))


if __name__ == "__main__":
    unittest.main()
