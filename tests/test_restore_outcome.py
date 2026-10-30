import unittest

import odoo_manager_web as web


class RestoreOutcomeTests(unittest.TestCase):
    def test_neutralization_outcome_does_not_assume_an_unknown_version(self):
        self.assertEqual("disabled", web.restored_neutralization_status(False, "native"))
        self.assertEqual("partial", web.restored_neutralization_status(True, "partial"))
        self.assertEqual("verified", web.restored_neutralization_status(True, "native"))
        self.assertEqual("unknown", web.restored_neutralization_status(True, ""))
        self.assertEqual("unknown", web.restored_neutralization_status(True, "inconnue"))


if __name__ == "__main__":
    unittest.main()
