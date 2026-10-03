"""Avancement global d'une action : une seule barre, de 0 à 100 %, qui avance sans jamais reculer.

L'action découpe au besoin son travail en tranches (`span`) : chacune occupe une part fixe de la
barre et porte le libellé affiché. Dans une tranche, la barre suit ce qui se mesure (`measure` :
téléchargement Git, décompression, chargement des modules Odoo…) ; tant que rien ne se mesure,
elle avance avec le temps vers la fin de la tranche, sans l'atteindre, selon la durée attendue.
Une phase mesurée qui repart de zéro ne fait donc jamais revenir la barre en arrière.

Comme `jobs`, le code métier n'a pas besoin de connaître l'action qui l'appelle : les fonctions
de ce module agissent sur l'avancement lié au fil courant et ne font rien hors d'une action.
"""

import contextlib
import threading
import time

# La barre n'atteint 100 % qu'à la fin de l'action : avant, c'est une estimation.
MAX_RUNNING_PERCENT = 99
DEFAULT_EXPECTED_SECONDS = 30
DEFAULT_LABEL = "Traitement en cours"


def time_fraction(elapsed, expected):
    """Part d'une tranche attribuée au temps écoulé : 2/3 à la durée attendue, puis de plus en plus lentement.

    La courbe ne plafonne jamais tout à fait : une étape plus longue que prévu continue d'avancer.
    """
    if elapsed <= 0:
        return 0.0
    return elapsed / (elapsed + max(expected, 1) / 2)


class JobProgress:
    def __init__(self, expected_seconds=DEFAULT_EXPECTED_SECONDS, label=DEFAULT_LABEL, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._shown = 0.0
        self.label = label
        self._begin(MAX_RUNNING_PERCENT, expected_seconds)

    def _begin(self, end, expected_seconds):
        self._start = self._shown
        self._end = min(max(float(end), self._start), MAX_RUNNING_PERCENT)
        self._started_at = self._clock()
        self._expected = max(float(expected_seconds or DEFAULT_EXPECTED_SECONDS), 1.0)
        self._fraction = 0.0
        self._sequence_total = None
        self._sequence_origin = 0

    def _current(self):
        elapsed = self._clock() - self._started_at
        fraction = max(self._fraction, time_fraction(elapsed, self._expected))
        value = self._start + (self._end - self._start) * fraction
        self._shown = max(self._shown, min(value, MAX_RUNNING_PERCENT))
        return self._shown

    def span(self, label=None, *, end=None, share=None, expected=DEFAULT_EXPECTED_SECONDS):
        """Ouvre la tranche suivante, de la position actuelle jusqu'à `end` (en %).

        `share` désigne plutôt la part de ce qui reste : utile au code appelé par plusieurs actions,
        qui ignore où en est la barre.
        """
        with self._lock:
            shown = self._current()
            if end is None:
                end = shown + (MAX_RUNNING_PERCENT - shown) * (1.0 if share is None else share)
            if label:
                self.label = str(label)
            self._begin(end, expected)

    def measure(self, current, total=None):
        """Avancement mesuré dans la tranche : `current / total`, ou une fraction si `total` manque."""
        try:
            fraction = float(current) / float(total) if total is not None else float(current)
        except (TypeError, ValueError, ZeroDivisionError):
            return
        with self._lock:
            self._fraction = max(self._fraction, min(max(fraction, 0.0), 1.0))

    def measure_position(self, index, total):
        """Place d'un élément dans une liste parcourue en partie seulement.

        Odoo parcourt tous les modules de la base mais n'annonce que ceux qu'il installe ou met à
        jour : le premier annoncé sert d'origine, sinon la mise à jour d'un module placé en fin de
        liste remplirait la barre d'emblée.
        """
        with self._lock:
            if total != self._sequence_total:
                self._sequence_total, self._sequence_origin = total, index
            origin = self._sequence_origin
            fraction = (index - origin) / max(total - origin + 1, 1)
            self._fraction = max(self._fraction, min(max(fraction, 0.0), 1.0))

    def snapshot(self):
        with self._lock:
            return {"label": self.label, "percent": int(self._current())}


_STATE = threading.local()


def current_progress():
    return getattr(_STATE, "progress", None)


@contextlib.contextmanager
def bind_progress(progress):
    previous = current_progress()
    _STATE.progress = progress
    try:
        yield progress
    finally:
        _STATE.progress = previous


def span(label=None, *, end=None, share=None, expected=DEFAULT_EXPECTED_SECONDS):
    progress = current_progress()
    if progress is not None:
        progress.span(label, end=end, share=share, expected=expected)


def measure(current, total=None):
    progress = current_progress()
    if progress is not None:
        progress.measure(current, total)
