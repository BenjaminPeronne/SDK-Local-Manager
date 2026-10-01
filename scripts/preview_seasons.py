#!/usr/bin/env python3
"""Ouvre l'interface dans le navigateur sur chaque décoration de saison, sans attendre la bonne date.

L'interface doit déjà tourner (``npm --prefix odoo-manager-next run dev``). Le script ouvre un
onglet par cas, ou seulement celui demandé :

    python3 scripts/preview_seasons.py               # tous les cas
    python3 scripts/preview_seasons.py confettis     # un seul cas
    python3 scripts/preview_seasons.py --url http://localhost:3001
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
import webbrowser

DEFAULT_URL = "http://localhost:3000"

# Ordre d'ouverture : le dernier onglet, celui des confettis, est celui qu'on voit en premier.
CASES = {
    "hors-saison": (
        "?season=none",
        "Interface habituelle : ni chapeau, ni guirlande, ni animation.",
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


def interface_responds(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            return response.status < 500
    except (urllib.error.URLError, OSError):
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Aperçu des décorations de saison dans le navigateur.")
    parser.add_argument(
        "case", nargs="?", choices=[*CASES, "tous"], default="tous", help="cas à ouvrir (défaut : tous)"
    )
    parser.add_argument("--url", default=DEFAULT_URL, help=f"adresse de l'interface (défaut : {DEFAULT_URL})")
    args = parser.parse_args()

    base_url = args.url.rstrip("/")
    if not interface_responds(base_url):
        print(f"L'interface ne répond pas sur {base_url}.", file=sys.stderr)
        print("Lance-la d'abord : npm --prefix odoo-manager-next run dev", file=sys.stderr)
        return 1

    selected = CASES if args.case == "tous" else {args.case: CASES[args.case]}
    for name, (query, description) in selected.items():
        url = f"{base_url}/{query}"
        print(f"{name:<12} {url}\n             {description}")
        webbrowser.open_new_tab(url)
        # Laisse le navigateur ouvrir les onglets dans l'ordre.
        time.sleep(0.4)
    print("\nRéduire les animations dans le système coupe les flocons et les confettis : c'est voulu.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
