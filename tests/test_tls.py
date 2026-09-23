import ssl
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from odoo_manager_core import tls
from odoo_manager_core.project_creator import ProjectCreator

ROOT = Path(__file__).resolve().parents[1]


class TrustedSslContextTests(unittest.TestCase):
    def test_context_keeps_certificate_and_hostname_verification(self):
        context = tls.trusted_ssl_context(bundles=("/nonexistent/bundle.pem",))

        self.assertEqual(ssl.CERT_REQUIRED, context.verify_mode)
        self.assertTrue(context.check_hostname)

    def test_existing_system_bundles_are_loaded_and_missing_ones_skipped(self):
        with tempfile.TemporaryDirectory() as temporary:
            present = Path(temporary) / "cert.pem"
            present.write_text("", encoding="utf-8")
            context = mock.Mock()
            with (
                mock.patch("odoo_manager_core.tls.ssl.create_default_context", return_value=context),
                mock.patch.dict("sys.modules", {"certifi": None}),
            ):
                tls.trusted_ssl_context(bundles=(str(present), "/nonexistent/bundle.pem"))

        context.load_verify_locations.assert_called_once_with(cafile=str(present))

    def test_unreadable_bundle_does_not_prevent_using_the_others(self):
        with tempfile.TemporaryDirectory() as temporary:
            first, second = Path(temporary) / "a.pem", Path(temporary) / "b.pem"
            first.write_text("", encoding="utf-8")
            second.write_text("", encoding="utf-8")
            context = mock.Mock()
            context.load_verify_locations.side_effect = [ssl.SSLError("bad bundle"), None]
            with (
                mock.patch("odoo_manager_core.tls.ssl.create_default_context", return_value=context),
                mock.patch.dict("sys.modules", {"certifi": None}),
            ):
                tls.trusted_ssl_context(bundles=(str(first), str(second)))

        self.assertEqual(2, context.load_verify_locations.call_count)


class RikaTlsErrorTests(unittest.TestCase):
    def download_failing_with(self, reason):
        class Opener:
            def open(self, request, timeout=None):
                raise urllib.error.URLError(reason)

        with mock.patch("odoo_manager_core.project_creator.platform_id", return_value="linux"):
            creator = ProjectCreator(mock.Mock(), ROOT, mock.Mock())
        with mock.patch("urllib.request.build_opener", return_value=Opener()):
            creator.download_rika_project("dev06", "login", "secret", ROOT)

    def test_certificate_failure_is_not_reported_as_a_network_outage(self):
        reason = ssl.SSLCertVerificationError("certificate verify failed: unable to get local issuer certificate")

        with self.assertRaisesRegex(RuntimeError, "certificat HTTPS de RIKA"):
            self.download_failing_with(reason)

    def test_real_network_failure_keeps_the_connection_message(self):
        with self.assertRaisesRegex(RuntimeError, "RIKA est inaccessible"):
            self.download_failing_with(OSError("Network is unreachable"))

    def test_rika_requests_use_the_trusted_context(self):
        handlers = []

        def build_opener(*args):
            handlers.extend(args)
            raise urllib.error.URLError(OSError("stop"))

        with mock.patch("odoo_manager_core.project_creator.platform_id", return_value="linux"):
            creator = ProjectCreator(mock.Mock(), ROOT, mock.Mock())
        with (
            mock.patch("urllib.request.build_opener", side_effect=build_opener),
            self.assertRaises(urllib.error.URLError),
        ):
            creator.download_rika_project("dev06", "login", "secret", ROOT)

        https = [handler for handler in handlers if handler.__class__.__name__ == "HTTPSHandler"]
        self.assertEqual(1, len(https))
        self.assertIs(tls.trusted_ssl_context(), https[0]._context)
