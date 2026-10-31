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

                def build(arguments):
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
