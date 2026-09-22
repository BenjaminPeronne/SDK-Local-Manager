# Application de bureau Electron

L'application de bureau est construite avec Electron 44.3 et electron-builder 26.15.
Elle charge l'export statique de l'interface Next.js et lance le backend Python
embarqué. Elle remplace depuis la version 0.2.0 l'ancienne coque Tauri, dont les
sources ont été retirées du dépôt.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `electron/main.cjs` | Fenêtre, cycle de vie, protocole local `app://sdk`, permissions et IPC. |
| `electron/preload.cjs` | Capacités natives exposées à l'interface, une par une, sans accès brut à IPC. |
| `electron/runtime.cjs` | Configuration, choix du port, lancement du backend, règles d'URL et CSP. |
| `electron/wsl.cjs` | Installation, préparation et démarrage de l'environnement Linux sous Windows. |
| `electron/gitlab.cjs` | Connexion au compte GitLab et recherche des dépôts, branches et tags. |
| `electron/credentials.cjs` | Identifiants RIKA et jeton GitLab chiffrés par `safeStorage`. |
| `electron/after-pack.cjs` | Efface les métadonnées Finder du bundle macOS avant signature. |
| `lib/desktop.ts` | Contrat TypeScript entre l'interface et le preload. |
| `electron-builder.yml` | Installateurs, et ressources hors ASAR pour le backend. |
| `scripts/build_electron_sidecar.py` | Backend Python embarqué par PyInstaller. |

## Sécurité

Le rendu utilise `contextIsolation`, le sandbox Chromium et `nodeIntegration: false` :
la page n'a pas accès à Node.js. La CSP autorise les empreintes exactes des scripts
de démarrage Next et, pour les connexions, seulement le port choisi pour le backend.
Les liens HTTP(S) s'ouvrent dans le navigateur système ; les schémas de fichiers et
de commandes sont refusés. L'écriture dans le presse-papiers est permise, les autres
permissions Web sont refusées. Les notifications passent par l'API native.

Les secrets (identifiants RIKA, jeton GitLab) sont chiffrés par le trousseau du
système et ne sont jamais écrits en clair dans `config.json`. Un jeton GitLab
enregistré qui ne peut plus être déchiffré est signalé : le compte est à reconnecter.

## Backend embarqué

Le backend est construit en mode « onedir » : l'exécutable et son dossier
`odoo-manager-backend-runtime/` sont copiés côte à côte dans `Resources/backend/`,
sur les trois systèmes. Le mode « onefile » réextrayait 17 Mo à chaque lancement,
soit 5 à 6 s avant la première fenêtre sous macOS, et passait par `%TEMP%` sous Windows.

Le backend écoute sur loopback. Le port configuré est utilisé s'il est libre, sinon
un port éphémère est choisi. Une identité d'instance permet de vérifier le backend
avant de lui demander de s'arrêter. La fermeture de l'application attend l'arrêt du
backend et force l'arrêt de son processus en dernier recours.

Sous Windows, le backend Linux est copié dans la distribution WSL « SDK-Manager » et
lancé à l'intérieur. S'il ne démarre pas, l'application bascule sur le backend
Windows, l'écrit dans `backend.log` et l'indique dans l'interface.

## Configuration

Le fichier de configuration reste celui d'Odoo Manager :

- macOS : `~/Library/Application Support/Odoo Manager/config.json` ;
- Windows : `%APPDATA%/Odoo Manager/config.json` ;
- Linux : `$XDG_CONFIG_HOME/odoo-manager/config.json` ou `~/.config/odoo-manager/config.json` ;
- les variables `ODOO_MANAGER_CONFIG` et `ODOO_MANAGER_CONFIG_DIR` restent prioritaires.

## Construction et tests

```sh
cd odoo-manager-next
npm ci
npm run test:desktop
npm run build:desktop
cd ..
python3 -m unittest discover -s tests -q
sh scripts/build_local_desktop.sh
python3 scripts/smoke_test_electron.py --bundle-directory odoo-manager-next/release
```

Ne pas lancer `typecheck` en même temps que `build:desktop` : Next régénère les
types `.next/types` lus par TypeScript. Le script de construction les enchaîne.

Le smoke test utilise une configuration et un dossier de projets temporaires. Il
vérifie le moteur chargé, le preload, l'absence de Node dans la page, le rendu React,
la santé de l'API depuis Chromium, puis l'arrêt du backend à la fermeture. Il ne
touche à aucune base Odoo réelle.

## Distribution

Les paquets macOS sont signés ad hoc, sans notarisation. La signature se fait dans
un dossier temporaire hors de `Documents`, pour éviter que le fournisseur de
fichiers n'y réintroduise des métadonnées ; les DMG et ZIP finaux sont recopiés
dans `release/`. La notarisation Apple demandera une identité Developer ID dédiée.

Aucune mise à jour automatique n'est activée : les nouvelles versions se
distribuent par les installateurs `.dmg`, `.exe`, `.deb` et `.AppImage`. Une
version précédente réinstallée réutilise le même fichier de configuration, sans
restauration de base.

Au premier accès au dossier `Documents`, macOS demande une autorisation : tant
qu'elle n'est pas accordée, le backend reste bloqué sur la lecture du dossier des
projets.
