import unittest

from odoo_manager_core import job_progress


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class JobProgressTests(unittest.TestCase):
    """Une seule barre par action : elle avance avec le temps et les mesures, sans jamais reculer."""

    def setUp(self):
        self.clock = FakeClock()
        self.progress = job_progress.JobProgress(expected_seconds=60, clock=self.clock)

    def percent(self):
        return self.progress.snapshot()["percent"]

    def test_bar_moves_with_time_when_nothing_is_measured(self):
        seen = []
        for seconds in (0, 5, 30, 60, 300, 3600):
            self.clock.now = seconds
            seen.append(self.percent())
        self.assertEqual(0, seen[0])
        self.assertEqual(sorted(set(seen)), seen, "la barre avance à chaque relecture")
        self.assertEqual(66, seen[3], "aux deux tiers à la durée attendue")
        self.assertLess(seen[-1], 100)

    def test_bar_never_goes_back_when_a_new_phase_restarts_from_zero(self):
        self.progress.span("Téléchargement", end=50, expected=10_000)
        self.progress.measure(0.9)
        high = self.percent()
        self.progress.measure(0.1)
        self.assertEqual(high, self.percent())
        self.progress.span("Préparation", end=60, expected=10_000)
        self.assertGreaterEqual(self.percent(), high)

    def test_spans_split_the_bar_and_measures_fill_the_current_one(self):
        self.progress.span("Téléchargement d'Odoo", end=40, expected=10_000)
        self.progress.measure(1, 2)
        self.assertEqual({"label": "Téléchargement d'Odoo", "percent": 20}, self.progress.snapshot())
        self.progress.span("Démarrage du projet", end=99, expected=10_000)
        self.progress.measure(1.0)
        self.assertEqual(99, self.percent(), "100 % est réservé à la fin de l'action")

    def test_share_takes_part_of_what_remains(self):
        self.progress.span(end=50, expected=10_000)
        self.progress.measure(1.0)
        self.progress.span("Mise à jour des modules", share=0.5, expected=10_000)
        self.progress.measure(1.0)
        self.assertEqual(74, self.percent())

    def test_odoo_modules_count_from_the_first_one_announced(self):
        # Mise à jour d'un seul module placé en fin de liste : la barre ne se remplit pas d'emblée.
        self.progress.span(end=99, expected=10_000)
        self.progress.measure_position(150, 151)
        self.assertEqual(0, self.percent())
        self.progress.measure_position(151, 151)
        self.assertEqual(49, self.percent())

    def test_helpers_do_nothing_outside_an_action(self):
        job_progress.span("Hors action", end=50)
        job_progress.measure(1, 2)
        with job_progress.bind_progress(self.progress):
            job_progress.span("Dans l'action", end=50, expected=10_000)
            job_progress.measure(1, 2)
        self.assertEqual({"label": "Dans l'action", "percent": 25}, self.progress.snapshot())


if __name__ == "__main__":
    unittest.main()
