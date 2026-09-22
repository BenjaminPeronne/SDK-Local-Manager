# Ancien menu en ligne de commande (archivé)

Ces scripts précèdent l'application de bureau. Ils ne sont plus appelés par
l'application, ni embarqués dans ses installateurs : ils restent ici comme
référence, et utilisables à la main tant qu'ils n'ont pas été supprimés.

| Fichier | Rôle |
| --- | --- |
| `odoo_manager.sh` | Menu interactif et commandes directes sur les projets Odoo locaux (POSIX sh). |
| `odoo_gui.sh` | Ancien alias de lancement, qui démarre aujourd'hui `odoo_next_gui.sh` à la racine du dépôt. |

## Utilisation

Le script cherche les projets dans `~/Documents/Developer/Odoo-projects`, puis
dans les emplacements usuels. `ODOO_WORKSPACE` force un autre dossier :

```bash
ODOO_WORKSPACE=~/Documents/Developer/Odoo-projects sh archive/cli/odoo_manager.sh
```

Commandes directes :

```bash
sh archive/cli/odoo_manager.sh --list
sh archive/cli/odoo_manager.sh --start PROJET
sh archive/cli/odoo_manager.sh --stop PROJET
sh archive/cli/odoo_manager.sh --dbs PROJET
sh archive/cli/odoo_manager.sh --update-module PROJET BASE MODULE
sh archive/cli/odoo_manager.sh --install-module PROJET BASE MODULE
sh archive/cli/odoo_manager.sh --update-all-modules PROJET BASE
sh archive/cli/odoo_manager.sh --logs PROJET
sh archive/cli/odoo_manager.sh --shell PROJET
```

`--create-project` repose encore sur Brainkeys : si Brainkeys propose de lancer
les conteneurs, répondre `Non`, le script s'en charge ensuite.
