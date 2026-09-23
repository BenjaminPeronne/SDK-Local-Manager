"""Version publique de l'application, vue par le backend.

Le backend est empaqueté séparément de l'interface et ne peut pas lire `package.json` :
`scripts/set_app_version.py` tient ce fichier à jour en même temps que les manifestes.
"""

APP_VERSION = "0.8.3"
