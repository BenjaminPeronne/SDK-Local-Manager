#!/usr/bin/env python3
"""Ouvre l'interface dans le navigateur sur chaque décoration de saison, sans attendre la bonne date.

L'interface et son service local doivent déjà tourner (``./odoo_next_gui.sh``). Le script ouvre
un onglet par cas, ou seulement celui demandé :

    python3 scripts/preview_seasons.py               # tous les cas
    python3 scripts/preview_seasons.py confettis     # un seul cas
    python3 scripts/preview_seasons.py --url http://127.0.0.1:3001
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
import webbrowser

# Adresse de ./odoo_next_gui.sh.
DEFAULT_URL = "http://127.0.0.1:3000"

# Ordre d'ouverture : le dernier onglet, celui des confettis, est celui qu'on voit en premier.
CASES = {
    "hors-saison": (
        "?season=none",
        "Interface habituelle : ni chapeau, ni guirlande, ni animation.",
    ),
    "paques": (
        "?season=easter",
        "Oreilles de lapin sur les logos, guirlande pastel, œufs qui tombent et « Joyeuses Pâques » sur l'accueil.",
    ),
    "halloween": (
        "?season=halloween",
        "Chapeau de sorcière sur les logos, guirlande orange et violette, chauves-souris et « Joyeux Halloween »"
        " sur l'accueil.",
    ),
    "noel": (
        "?season=christmas",
        "Bonnet sur les logos, guirlande rouge et verte, flocons et « Joyeux Noël » sur l'accueil.",
    ),
    "nouvel-an": (
        "?season=new-year",
        "Guirlande dorée et vœux de bonne année sur l'accueil.",
    ),
    "confettis": (
        "?season=new-year&confetti=1",
        "Salve de confettis à l'ouverture (recharge l'onglet pour la rejouer).",
    ),
}


def http_status(url: str) -> int | None:
    """Code de réponse HTTP, ou None si rien ne répond à cette adresse."""
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, OSError):
        return None


def startup_problem(base_url: str) -> str | None:
    """Ce qui empêcherait l'aperçu de s'afficher, en mots simples ; None si tout est prêt."""
    interface = http_status(base_url)
    if interface is None or interface >= 500:
        return f"L'interface ne répond pas sur {base_url}.\nLance-la d'abord : ./odoo_next_gui.sh"
    service = http_status(f"{base_url}/api/health")
    if service == 401:
        # Le service local de l'app de bureau occupe le port : il refuse l'interface de développement,
        # qui attendrait alors indéfiniment sur « Démarrage du service local… ».
        return (
            "L'interface répond, mais le service local qu'elle contacte la refuse : l'app de bureau "
            "SDK Local Manager est sans doute ouverte.\n"
            "Quitte-la (⌘Q), puis relance : ./odoo_next_gui.sh --stop && ./odoo_next_gui.sh"
        )
    if service != 200:
        return (
            "L'interface répond, mais pas son service local.\n"
            "Relance les deux ensemble : ./odoo_next_gui.sh --stop && ./odoo_next_gui.sh"
        )
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Aperçu des décorations de saison dans le navigateur.")
    parser.add_argument(
        "case", nargs="?", choices=[*CASES, "tous"], default="tous", help="cas à ouvrir (défaut : tous)"
    )
    parser.add_argument("--url", default=DEFAULT_URL, help=f"adresse de l'interface (défaut : {DEFAULT_URL})")
    args = parser.parse_args()

    base_url = args.url.rstrip("/")
    problem = startup_problem(base_url)
    if problem:
        print(problem, file=sys.stderr)
        return 1

    selected = CASES if args.case == "tous" else {args.case: CASES[args.case]}
    for name, (query, description) in selected.items():
        url = f"{base_url}/{query}"
        print(f"{name:<12} {url}\n             {description}")
        webbrowser.open_new_tab(url)
        # Laisse le navigateur ouvrir les onglets dans l'ordre.
        time.sleep(0.4)
    print("\nRéduire les animations dans le système coupe les œufs, chauves-souris, flocons et confettis : c'est voulu.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
