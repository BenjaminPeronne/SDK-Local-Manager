import unittest
import warnings

from odoo_manager_core.manifests import parse_manifest_text


class ParseManifestTextTests(unittest.TestCase):
    def test_invalid_escape_is_read_without_warning(self):
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            manifest = parse_manifest_text("{'name': 'A', 'description': 'a\\ b'}")
        self.assertEqual(manifest["description"], "a\\ b")


if __name__ == "__main__":
    unittest.main()
