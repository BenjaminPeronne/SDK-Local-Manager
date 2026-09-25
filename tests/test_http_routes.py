import unittest

from odoo_manager_core.http_routes import Route, Router, RouteRequest, compile_template


def view(_request):
    return {}


def on_error(_handler, _exc):
    return None


class CompileTemplateTests(unittest.TestCase):
    def test_parameters_match_one_path_segment(self):
        pattern = compile_template("/api/projects/{project}/modules")

        self.assertEqual({"project": "DEMO"}, pattern.match("/api/projects/DEMO/modules").groupdict())
        self.assertIsNone(pattern.match("/api/projects/a/b/modules"))
        self.assertIsNone(pattern.match("/api/projects/DEMO/modules/extra"))

    def test_job_identifier_is_numeric(self):
        pattern = compile_template("/api/jobs/{job}/cancel")

        self.assertEqual({"job": "42"}, pattern.match("/api/jobs/42/cancel").groupdict())
        self.assertIsNone(pattern.match("/api/jobs/abc/cancel"))

    def test_literal_characters_are_not_regular_expressions(self):
        pattern = compile_template("/favicon.ico")

        self.assertIsNotNone(pattern.match("/favicon.ico"))
        self.assertIsNone(pattern.match("/faviconXico"))

    def test_unknown_parameter_is_refused(self):
        with self.assertRaises(ValueError):
            compile_template("/api/{database}")


class RouterTests(unittest.TestCase):
    def setUp(self):
        self.router = Router(
            (
                Route("GET", "/api/projects/{project}/socle", view, on_error),
                Route("GET", "/api/projects/{project}/socle/plan", view, on_error),
                Route("POST", "/api/jobs", view, on_error),
                Route("GET", "/", view, on_error),
            )
        )

    def test_resolves_by_method_and_exact_path(self):
        route, params = self.router.resolve("GET", "/api/projects/DEMO/socle/plan")

        self.assertEqual("/api/projects/{project}/socle/plan", route.template)
        self.assertEqual({"project": "DEMO"}, params)
        self.assertEqual((None, None), self.router.resolve("GET", "/api/jobs"))
        self.assertEqual((None, None), self.router.resolve("DELETE", "/api/jobs"))

    def test_templates_list_only_api_routes_of_a_method(self):
        self.assertEqual(
            ("/api/projects/{project}/socle", "/api/projects/{project}/socle/plan"), self.router.templates("GET")
        )

    def test_duplicate_route_is_refused(self):
        with self.assertRaises(ValueError):
            Router((Route("GET", "/api/jobs", view, on_error), Route("GET", "/api/jobs", view, on_error)))


class RouteRequestTests(unittest.TestCase):
    def test_decodes_path_parameters_and_reads_first_query_value(self):
        request = RouteRequest(None, {"project": "MY%20PROJECT"}, {"db": ["prod", "other"]})

        self.assertEqual("MY PROJECT", request.param("project"))
        self.assertEqual("prod", request.query_value("db"))
        self.assertEqual("", request.query_value("raw"))
