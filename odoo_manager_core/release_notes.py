"""Nouveautés de chaque version, affichées dans l'application (À propos, annonce de mise à jour).

Une entrée par version publiée, la plus récente en tête : (version, date, (changements…)).
Chaque changement est une phrase courte, en français simple, du point de vue de l'utilisateur.
Un test exige une entrée pour la version de `version.py` : à compléter à chaque montée de version.

Le fichier n'est que des données : une version plus récente le lit depuis le dépôt sans l'exécuter
(voir `parse_release_notes`).
"""

import ast
import sys

RELEASE_NOTES = (
    (
        "0.54.0",
        "2026-11-26",
        ("Dans la liste des bases, vous pouvez en cocher plusieurs et les supprimer en une seule fois.",),
    ),
    (
        "0.53.2",
        "2026-11-23",
        (
            "« Ouvrir sur mobile » donne toujours l’adresse actuelle du poste : après un changement de Wi-Fi, "
            "le QR code menait à une ancienne adresse et la page restait noire sur le téléphone.",
            "Avant de changer de branche d’un dépôt, les fichiers ajoutés depuis la dernière sauvegarde sont eux "
            "aussi mis de côté ou abandonnés, selon ton choix.",
        ),
    ),
    (
        "0.53.1",
        "2026-11-18",
        (
            "L’application interroge moins souvent l’ordinateur quand tout est à jour : elle reste plus légère "
            "lorsqu’elle est ouverte longtemps.",
            "L’IoT Box reste reliée à sa base après l’ouverture d’Odoo dans le navigateur : avant, elle cherchait "
            "la base à une adresse qu’elle ne pouvait pas joindre et les appareils ne répondaient plus.",
            "Sous Windows, quand un autre programme répond déjà à l’adresse des projets, l’application en choisit "
            "une autre toute seule : avant, l’ouverture du projet échouait en accusant sa configuration.",
        ),
    ),
    (
        "0.53.0",
        "2026-11-18",
        (
            "Les projets se rangent dans des sections que l’on peut replier, trier et remplir en les glissant.",
            "Avant de changer de branche ou de mettre à jour un dépôt, l’application demande s’il faut mettre "
            "de côté ou abandonner les fichiers modifiés.",
        ),
    ),
    (
        "0.52.0",
        "2026-11-17",
        (
            "Les nouveautés de chaque version se lisent dans « À propos », et avant d’installer une mise à jour.",
            "Le bouton pour éteindre un projet a le même format que celui pour l’allumer, en rouge.",
            "La pastille « Docker » ouvre la fenêtre « Ressources » : le chemin du dossier des projets reste lisible.",
            "Dans les fenêtres où l’on tape un texte, comme le nom d’une base à supprimer, la touche Entrée valide.",
            "Correctif de sécurité de l’interface.",
        ),
    ),
    (
        "0.51.0",
        "2026-11-17",
        (
            "La fenêtre « Ressources » montre la charge sur tout l’ordinateur, la part prise par chaque projet, "
            "depuis quand il est allumé et dans combien de temps il sera éteint automatiquement.",
        ),
    ),
    (
        "0.50.2",
        "2026-11-17",
        ("Sous Windows, le téléphone ouvre de nouveau Odoo par l’accès mobile.",),
    ),
    (
        "0.50.1",
        "2026-11-17",
        (
            "Sous Windows, l’accès mobile utilise la bonne adresse Wi-Fi et explique quoi vérifier "
            "si le téléphone n’ouvre pas la page.",
        ),
    ),
    (
        "0.50.0",
        "2026-11-17",
        (
            "Nouvelle fenêtre « Ressources » : ce que chaque projet allumé prend sur l’ordinateur, "
            "avec un bouton pour l’éteindre.",
            "Les projets allumés depuis plus de 8 heures s’éteignent d’eux-mêmes (désactivable dans les paramètres).",
            "Un projet allumé en dehors du gestionnaire démarre aussi Odoo, au lieu de rester affiché éteint.",
            "Un bouton pour éteindre un projet apparaît au survol de la liste.",
        ),
    ),
    (
        "0.49.3",
        "2026-11-17",
        ("Les sauvegardes récentes se restaurent de nouveau sur les projets plus anciens.",),
    ),
    (
        "0.49.2",
        "2026-11-17",
        (
            "Le mode hors ligne explique qu’Odoo ne remarque la coupure qu’au clic suivant "
            "et ne garde que les écrans déjà ouverts.",
        ),
    ),
    (
        "0.49.1",
        "2026-11-17",
        ("Les bases locales n’affichent plus l’avertissement d’abonnement d’Odoo et ne contactent plus odoo.com.",),
    ),
    (
        "0.49.0",
        "2026-11-16",
        ("Le mode hors ligne se teste sur une adresse à part, réellement coupée du réseau.",),
    ),
    (
        "0.48.12",
        "2026-11-16",
        ("Les rapports PDF gardent leur mise en page, sur les nouvelles bases comme sur les anciennes.",),
    ),
    (
        "0.48.11",
        "2026-11-16",
        ("Mettre à jour plusieurs bases d’un coup ne relance Odoo qu’une seule fois : c’est plus rapide.",),
    ),
    (
        "0.48.10",
        "2026-11-16",
        ("Le menu du test hors ligne s’appelle « Mode hors ligne » et explique quand les pages se coupent.",),
    ),
    (
        "0.48.9",
        "2026-11-13",
        ("Un projet allumé sans Odoo reste au-dessus des projets éteints dans la liste.",),
    ),
    (
        "0.48.8",
        "2026-11-13",
        (
            "Sous Linux, la corbeille se vide sans demander le mot de passe administrateur.",
            "Sans carte graphique, les animations décoratives sont retirées pour garder la fenêtre fluide.",
        ),
    ),
    (
        "0.48.7",
        "2026-11-13",
        ("Sous Linux, la taille de la corbeille compte tous les dossiers.",),
    ),
    (
        "0.48.6",
        "2026-11-13",
        (
            "Sous Linux, la taille des bases et de leurs fichiers est mesurée correctement.",
            "Les conseils de mémoire s’appliquent aussi aux ordinateurs Linux équipés de Docker Desktop.",
        ),
    ),
    (
        "0.48.5",
        "2026-11-12",
        (
            "L’utilisateur de test a une adresse e-mail : Odoo peut publier dans le fil de discussion.",
            "L’état des projets s’affiche correctement quand plusieurs moteurs Docker sont installés.",
        ),
    ),
    (
        "0.48.4",
        "2026-11-12",
        (
            "La gestion des bases d’Odoo n’est plus ouverte aux appareils du Wi-Fi.",
            "Quand le dossier des projets est vide, le gestionnaire propose celui où des projets tournent déjà.",
        ),
    ),
    (
        "0.48.3",
        "2026-11-12",
        ("La barre de progression avance pendant la dernière étape d’une restauration.",),
    ),
    (
        "0.48.2",
        "2026-11-12",
        (
            "Une base s’ouvre sur un téléphone en scannant un QR code.",
            "Supprimer une base ne touche plus aux fichiers des autres bases.",
            "Les boutons Mobile et Actions ne chevauchent plus les colonnes de la liste des bases.",
        ),
    ),
    (
        "0.48.0",
        "2026-11-06",
        ("Nouveau : tester le mode hors ligne et ouvrir Odoo sur un téléphone.",),
    ),
    (
        "0.47.6",
        "2026-11-06",
        ("L’IoT Box virtuelle attend plus longtemps au démarrage et dit pourquoi elle a échoué.",),
    ),
    (
        "0.47.5",
        "2026-11-06",
        ("L’IoT Box virtuelle tourne avec moins de droits et son journal est plus lisible.",),
    ),
    (
        "0.47.4",
        "2026-11-06",
        ("La recherche d’appareils de l’IoT Box ne bloque plus les imprimantes Zebra.",),
    ),
    (
        "0.47.3",
        "2026-11-06",
        ("Les tickets de caisse s’impriment sur les imprimantes d’étiquettes depuis l’IoT Box virtuelle.",),
    ),
    (
        "0.47.2",
        "2026-11-06",
        ("Les terminaux de paiement Ingenico sont joignables et la page de l’IoT Box s’affiche de nouveau.",),
    ),
    (
        "0.47.1",
        "2026-11-05",
        ("L’IoT Box virtuelle trouve les appareils du réseau.",),
    ),
    (
        "0.47.0",
        "2026-11-05",
        ("La liste des projets montre leur état par des pastilles et un bouton pour les allumer au survol.",),
    ),
    (
        "0.46.0",
        "2026-11-05",
        ("Nouveau : une IoT Box virtuelle à côté des projets (Odoo 17 à 19), reliée à une base.",),
    ),
    (
        "0.45.1",
        "2026-11-03",
        ("L’installation de l’accès web explique l’accès à GitLab dont elle a besoin.",),
    ),
    (
        "0.45.0",
        "2026-11-02",
        (
            "Les modules se filtrent par auteur, et le gestionnaire se souvient de l’onglet ouvert par projet.",
            "La version de chaque base est affichée.",
            "Effacer l’historique d’un projet ne touche plus aux autres projets.",
        ),
    ),
    (
        "0.44.0",
        "2026-11-02",
        (
            "Les projets favoris et les projets allumés passent en tête de liste.",
            "La liste des bases a son propre affichage, et le choix est retenu.",
            "Les mises à jour de l’application sont vérifiées par une signature avant d’être installées.",
        ),
    ),
)


def release_notes_payload(notes=RELEASE_NOTES):
    """Forme JSON des nouveautés : [{"version", "date", "items"}], la plus récente en tête."""
    return [{"version": version, "date": date, "items": list(items)} for version, date, items in notes]


def parse_release_notes(source):
    """Nouveautés lues dans le texte de ce fichier sans l'exécuter ; vide s'il est illisible.

    Sert pour une version plus récente, lue depuis le dépôt : seule la valeur littérale de
    `RELEASE_NOTES` est évaluée.
    """
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return ()
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "RELEASE_NOTES" for target in node.targets
        ):
            try:
                notes = ast.literal_eval(node.value)
            except (ValueError, SyntaxError):
                return ()
            if isinstance(notes, tuple) and all(
                isinstance(entry, tuple)
                and len(entry) == 3
                and isinstance(entry[0], str)
                and isinstance(entry[1], str)
                and isinstance(entry[2], tuple)
                and all(isinstance(item, str) for item in entry[2])
                for entry in notes
            ):
                return notes
            return ()
    return ()


def release_notes_markdown(version, notes=RELEASE_NOTES):
    """Description d'une Release GitLab : la liste des changements de `version`."""
    for entry_version, _date, items in notes:
        if entry_version == version:
            return "\n".join(f"- {item}" for item in items)
    raise KeyError(version)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage : python3 -m odoo_manager_core.release_notes <version>")
    try:
        print(release_notes_markdown(sys.argv[1]))
    except KeyError:
        raise SystemExit(
            f"Aucune nouveauté pour la version {sys.argv[1]} dans odoo_manager_core/release_notes.py."
        ) from None
