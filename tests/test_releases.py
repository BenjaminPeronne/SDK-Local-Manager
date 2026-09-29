import unittest

from odoo_manager_core.releases import RELEASES_PAGE, latest_release, release_update

LS_REMOTE = """\
fb9172f9a0ea52a388fb1e58d839793afa2ade72\trefs/tags/app-v0.8.0-build5
025eccfda594f6ea482dbbf5cc5fc82deba87f3c\trefs/tags/app-v0.8.3-build1
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/app-v0.10.0-build1
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/app-v0.10.0-build2
ce06254e41c669a69f466b807e01e1282d7143a0\trefs/tags/app-v0.9.0-build1
cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2.0.0
"""


class LatestReleaseTests(unittest.TestCase):
    def test_versions_compare_as_numbers_and_the_latest_build_wins(self):
        # 0.10 est plus récent que 0.9, bien que « 0.10 » soit inférieur à « 0.9 » en texte.
        self.assertEqual(("app-v0.10.0-build2", "0.10.0"), latest_release(LS_REMOTE))

    def test_tags_outside_the_release_scheme_are_ignored(self):
        self.assertIsNone(latest_release("cccc\trefs/tags/v2.0.0\n"))

    def test_a_tag_without_build_number_is_recognized(self):
        self.assertEqual(("app-v0.1.1", "0.1.1"), latest_release("dddd\trefs/tags/app-v0.1.1\n"))


class ReleaseUpdateTests(unittest.TestCase):
    def test_a_newer_release_is_offered_with_its_page(self):
        update = release_update("0.9.0", LS_REMOTE)

        self.assertTrue(update["update_available"])
        self.assertEqual("0.10.0", update["latest"])
        self.assertEqual(f"{RELEASES_PAGE}/app-v0.10.0-build2", update["url"])

    def test_the_current_version_is_not_an_update(self):
        self.assertFalse(release_update("0.10.0", LS_REMOTE)["update_available"])

    def test_a_development_version_ahead_of_the_releases_is_not_an_update(self):
        self.assertFalse(release_update("0.11.0", LS_REMOTE)["update_available"])

    def test_no_release_means_no_update(self):
        update = release_update("0.10.0", "")

        self.assertFalse(update["update_available"])
        self.assertEqual("", update["latest"])


if __name__ == "__main__":
    unittest.main()
