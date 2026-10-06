import json
import tempfile
import unittest
from pathlib import Path

from odoo_manager_core import git_checkouts

SHA = "4ca6a5538a9624338ca51749011bf2e208458644"
TAG_OBJECT = "1111111111111111111111111111111111111111"


def make_git_checkout(root, head, config="", packed_refs="", refs=None):
    git = root / ".git"
    git.mkdir(parents=True)
    (git / "HEAD").write_text(head + "\n", encoding="utf-8")
    (git / "config").write_text(config, encoding="utf-8")
    if packed_refs:
        (git / "packed-refs").write_text(packed_refs, encoding="utf-8")
    for ref, sha in (refs or {}).items():
        (git / ref).parent.mkdir(parents=True, exist_ok=True)
        (git / ref).write_text(sha + "\n", encoding="utf-8")
    return root


class CheckoutReadingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_branch_commit_and_origin_are_read_from_git_files(self):
        checkout = make_git_checkout(
            self.root / "pos",
            "ref: refs/heads/19.0-mig-pos_financial_risk",
            config=(
                "[core]\n\tbare = false\n"
                '[remote "upstream"]\n\turl = https://github.com/OCA/pos.git\n'
                '[remote "origin"]\n\turl = ssh://git@gitlab.sudokeys.com:10022/OCA/pos.git\n'
                "\tfetch = +refs/heads/*:refs/remotes/origin/*\n"
            ),
            packed_refs=f"# pack-refs with: peeled\n{SHA} refs/heads/19.0-mig-pos_financial_risk\n",
        )

        self.assertEqual(
            {
                "source": "git",
                "branch": "19.0-mig-pos_financial_risk",
                "tag": "",
                "commit": SHA,
                "remote": "ssh://git@gitlab.sudokeys.com:10022/OCA/pos.git",
                "remote_label": "gitlab.sudokeys.com/OCA/pos",
            },
            git_checkouts.read_checkout(checkout),
        )

    def test_detached_commit_is_named_by_its_tag(self):
        annotated = make_git_checkout(
            self.root / "annotated",
            SHA,
            packed_refs=f"{TAG_OBJECT} refs/tags/19.0.1.0.2\n^{SHA}\n",
        )
        lightweight = make_git_checkout(self.root / "lightweight", SHA, refs={"refs/tags/v1": SHA})
        untagged = make_git_checkout(self.root / "untagged", SHA)

        self.assertEqual(
            ("", "19.0.1.0.2"), tuple(git_checkouts.read_checkout(annotated)[key] for key in ("branch", "tag"))
        )
        self.assertEqual("v1", git_checkouts.read_checkout(lightweight)["tag"])
        self.assertEqual(
            ("", "", SHA), tuple(git_checkouts.read_checkout(untagged)[key] for key in ("branch", "tag", "commit"))
        )

    def test_git_file_of_a_worktree_points_to_its_git_directory(self):
        main = make_git_checkout(
            self.root / "main",
            "ref: refs/heads/19.0",
            config='[remote "origin"]\n\turl = git@github.com:OCA/web.git\n',
        )
        worktree_git = main / ".git" / "worktrees" / "dev"
        worktree_git.mkdir(parents=True)
        (worktree_git / "HEAD").write_text("ref: refs/heads/dev\n", encoding="utf-8")
        (worktree_git / "commondir").write_text("../..\n", encoding="utf-8")
        worktree = self.root / "dev"
        worktree.mkdir()
        (worktree / ".git").write_text(f"gitdir: {worktree_git}\n", encoding="utf-8")

        info = git_checkouts.read_checkout(worktree)

        self.assertEqual(("dev", "github.com/OCA/web"), (info["branch"], info["remote_label"]))

    def test_sdk_download_is_described_by_its_info_file(self):
        download = self.root / "sudokeys-addons"
        download.mkdir()
        (download / "info.sdk").write_text(
            json.dumps(
                {
                    "remotes": {"origin": "ssh://git@gitlab.sudokeys.com:10022/sudokeys/sudokeys-addons.git"},
                    "active_branch": "19.0-mig",
                    "branchs": ["19.0", "19.0-mig"],
                    "commit": SHA,
                }
            ),
            encoding="utf-8",
        )

        info = git_checkouts.read_checkout(download)

        self.assertEqual(("sdk", "19.0-mig", SHA), (info["source"], info["branch"], info["commit"]))
        self.assertEqual("gitlab.sudokeys.com/sudokeys/sudokeys-addons", info["remote_label"])
        (download / "info.sdk").write_text("pas du JSON", encoding="utf-8")
        self.assertIsNone(git_checkouts.read_checkout(download))

    def test_remote_labels_drop_scheme_port_user_suffix_and_credentials(self):
        cases = {
            "ssh://git@gitlab.sudokeys.com:10022/OCA/pos.git": "gitlab.sudokeys.com/OCA/pos",
            "git@github.com:OCA/web.git": "github.com/OCA/web",
            "https://user:token@github.com/OCA/server-ux.git/": "github.com/OCA/server-ux",
            "": "",
        }
        for url, label in cases.items():
            with self.subTest(url=url):
                self.assertEqual(label, git_checkouts.remote_label(url))
        self.assertEqual(
            "https://github.com/OCA/server-ux.git",
            git_checkouts.without_credentials("https://user:token@github.com/OCA/server-ux.git"),
        )


class CheckoutFinderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name) / "DEMO"
        self.store = self.project / "odoo" / "addons-store"
        self.store.mkdir(parents=True)

    def tearDown(self):
        self.temporary.cleanup()

    def finder(self):
        return git_checkouts.CheckoutFinder(boundaries=(self.project, self.project / "odoo"))

    def test_module_inside_a_repository_folder_belongs_to_it(self):
        make_git_checkout(self.store / "sodial-addons", "ref: refs/heads/dev")
        module = self.store / "sodial-addons" / "sodial_base"
        module.mkdir()

        self.assertEqual(str(self.store / "sodial-addons"), self.finder().root(module))

    def test_project_folders_that_are_repositories_are_never_used(self):
        # Le dépôt de production du client suit odoo/ mais pas les copies d'addons-store.
        make_git_checkout(self.project / "odoo", "ref: refs/heads/preprod1")
        make_git_checkout(self.project, "ref: refs/heads/19.0")
        copy = self.store / "sudokeys_base"
        copy.mkdir()

        self.assertEqual("", self.finder().root(copy, check_module=True))

    def test_a_module_can_be_its_own_repository_when_asked(self):
        module = make_git_checkout(self.store / "sbr_pos_auto_lot", SHA)

        self.assertEqual("", self.finder().root(module))
        self.assertEqual(str(module), self.finder().root(module, check_module=True))


if __name__ == "__main__":
    unittest.main()
