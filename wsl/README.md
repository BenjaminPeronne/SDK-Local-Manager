# Distribution WSL « SDK-Manager »

Environnement Linux que l'application installe elle-même sous Windows. Les projets Odoo, Docker et le backend y tournent sur un système de fichiers Linux : Odoo démarre en 4 à 6 s au lieu de 48 à 95 s, et `-u base` prend 234 s au lieu de 504 s.

L'utilisateur n'ouvre jamais de terminal : l'application importe l'image, la démarre et la maintient à jour.

## Contenu

| Fichier | Rôle |
|---|---|
| `Dockerfile` | Racine du système : Debian 12, systemd, Docker Engine et Compose, Git, OpenSSH, utilisateur `sdk` (uid 1000) |
| `wsl.conf` | `systemd=true`, utilisateur par défaut, `appendWindowsPath=false`, disques Windows montés sous `/mnt` |
| `daemon.json` | Configuration de Docker, avec rotation des journaux de conteneurs |
| `provision.sh` | Préparation et mises à niveau, rejouable, exécuté comme `root` quand la version change |
| `known_hosts` | Clés d'hôte SSH vérifiées du GitLab Sudokeys (voir plus bas) |

L'image ne contient pas le backend : l'application y copie son propre exécutable Linux dans `/opt/sdk-manager/` à chaque mise à jour.

## Construire l'image

```bash
python3 scripts/build_wsl_image.py
```

Le script produit `dist/wsl/sdk-manager-<version>.wsl` et son empreinte `.sha256`. Il utilise `docker build` puis `docker export` : l'image n'est jamais exécutée comme conteneur, seule sa racine sert. La CI (`wsl-image`) la reconstruit à chaque version et vérifie son contenu.

Installation manuelle, pour une mise au point :

```bash
wsl --install --from-file dist/wsl/sdk-manager-0.5.0.wsl --name SDK-Manager --location "%LOCALAPPDATA%\SDK Local Manager\wsl" --no-launch
```

Suppression complète, projets compris :

```bash
wsl --unregister SDK-Manager
```

## Clés d'hôte GitLab

`known_hosts` contient les clés de `gitlab.sudokeys.com:10022`, les mêmes que `odoo_manager_core/ssh_hosts.py` (un test vérifie qu'elles restent identiques). Le backend les inscrit aussi dans `~/.ssh/known_hosts` sur macOS, Linux et Windows. Un serveur qui présenterait une autre clé est refusé dès le premier clone.

Si GitLab change de clés : relever les nouvelles empreintes, les comparer à celles affichées par GitLab, mettre à jour les deux fichiers, puis reconstruire l'image.

## Migrer un projet déjà présent sur `C:\`

L'application liste les projets restés sur le disque Windows et propose de les copier dans l'environnement Linux. Le dossier source est celui que l'ancienne version utilisait (réglage `workspace` de son `config.json`, sinon `Documents\Developer\Odoo-projects`, `Documents\Odoo-projects` ou `Odoo-projects`). Si les projets sont ailleurs, **Paramètres › Général › Anciens projets Windows** permet de choisir le dossier, sur n'importe quel disque. La copie prend le projet entier : code, liens d'addons, base PostgreSQL et filestore. Les liens sont recréés à l'identique, sans être suivis.

- **Le projet doit être arrêté.** Copier `postgresql_data` pendant que PostgreSQL écrit donnerait une base incohérente : l'application refuse tant que son fichier de verrou est présent.
- **L'original n'est jamais modifié.** Il reste sur `C:\` après la migration, jusqu'à ce que vous le supprimiez vous-même.
- **La copie est vérifiée** : mêmes fichiers, mêmes cibles de liens. En cas d'écart, la copie est conservée pour inspection et l'échec est signalé.
- Une copie interrompue est supprimée, pour ne pas laisser un demi-projet dans la liste.

## Mises à jour

L'application ne réimporte jamais la distribution : les projets y vivent. Quand sa version diffère de `/etc/sdk-manager-release`, elle exécute `provision.sh`, qui vérifie l'état avant d'agir et ne touche ni aux projets ni aux bases.
