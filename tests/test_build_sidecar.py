import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_electron_sidecar.py"
SPEC = importlib.util.spec_from_file_location("build_electron_sidecar_test", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SidecarCacheTests(unittest.TestCase):
    def test_clean_flag_controls_pyinstaller_cache(self):
        for clean in (False, True):
            with self.subTest(clean=clean), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                binaries = root / "binaries"
                calls = []

                def build(arguments, calls=calls, root=root):
                    calls.append(arguments)
                    output = root / ".electron-sidecar-build" / "dist" / "odoo-manager-backend"
                    (output / MODULE.RUNTIME_NAME).mkdir(parents=True)
                    suffix = ".exe" if MODULE.os.name == "nt" else ""
                    (output / f"odoo-manager-backend{suffix}").write_text("backend")

                package = types.ModuleType("PyInstaller")
                package.__path__ = []
                main = types.ModuleType("PyInstaller.__main__")
                main.run = build
                package.__main__ = main
                args = [str(SCRIPT)] + (["--clean"] if clean else [])
                with patch.object(MODULE, "ROOT", root), patch.object(MODULE, "BINARIES", binaries), \
                     patch.object(sys, "argv", args), patch.dict(sys.modules, {"PyInstaller": package, "PyInstaller.__main__": main}), \
                     patch.dict(MODULE.os.environ, {"PYINSTALLER_CONFIG_DIR": str(root / "config")}):
                    MODULE.main()
                self.assertEqual("--clean" in calls[0], clean)
                self.assertTrue((binaries / MODULE.RUNTIME_NAME).is_dir())


if __name__ == "__main__":
    unittest.main()


class LinuxPyInstallerVersionTests(unittest.TestCase):
    """PyInstaller 6.22 casse le démarrage depuis l'AppImage : la construction Linux doit le refuser."""

    def test_refuses_6_22_and_later_on_linux(self):
        for version in ("6.22.0", "6.22.3", "7.0"):
            with self.subTest(version=version), self.assertRaisesRegex(SystemExit, "AppImage"):
                MODULE.check_pyinstaller_version(version, "Linux")

    def test_accepts_the_pinned_version_and_other_systems(self):
        MODULE.check_pyinstaller_version("6.21.0", "Linux")
        MODULE.check_pyinstaller_version("6.22.3", "Darwin")
        MODULE.check_pyinstaller_version("6.22.3", "Windows")
        MODULE.check_pyinstaller_version("", "Linux")
