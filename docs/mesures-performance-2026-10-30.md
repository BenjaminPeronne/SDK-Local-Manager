# Mesures de performance — 30 octobre 2026

Ces mesures sont synthétiques, réalisées sur le poste de développement, et ne représentent pas la latence Docker, l'interface réelle ou le réseau. Elles ne modifient pas de projets. Commandes : `python3 scripts/benchmark_overview.py` et `node scripts/benchmark_overview_compare.cjs`.

Le premier script exécute 200 fois `overview` et sa sérialisation JSON. Les projets, URL, états Docker, bases, serveurs et lectures de configuration sont simulés. Il mesure la durée, le CPU du processus et la taille du JSON, et compte les demandes faites aux fonctions simulées ; ces nombres ne sont pas des commandes Docker réellement exécutées. Dix bases sont simulées par projet actif.

| Projets | Actifs | Durée p50 / p95 (ms) | CPU p50 / p95 (ms) | JSON (octets) |
| --- | --- | --- | --- | --- |
| 1 | non | 0,032 / 0,077 | 0,033 / 0,074 | 438 |
| 1 | oui | 0,035 / 0,092 | 0,035 / 0,082 | 543 |
| 10 | non | 0,150 / 0,270 | 0,150 / 0,234 | 3 183 |
| 10 | oui | 0,161 / 0,230 | 0,161 / 0,220 | 4 233 |
| 50 | non | 0,704 / 1,212 | 0,698 / 1,057 | 15 503 |
| 50 | oui | 0,752 / 0,885 | 0,752 / 0,863 | 20 753 |

Le second script compare deux structures égales avec le double `JSON.stringify` actuel, 5 000 fois dans Node : p50/p95 de 0,0006/0,0011 ms pour 1 projet, 0,0036/0,0041 ms pour 10 et 0,0173/0,0330 ms pour 50. Ce résultat ne mesure ni les allocations sous pression ni le moteur du navigateur. Il ne justifie pas à lui seul de changer le mécanisme.

Le backend appelle une fois la fonction d'état des conteneurs et demande l'état des bases et du serveur pour chaque projet actif dans le modèle simulé. En réel, les caches et les sondes parallèles modifient les coûts. De plus, `project_url` peut lancer `docker port` lorsqu'aucune route n'est trouvée dans le fichier compose : ce chemin n'est pas inclus dans ces mesures et mérite un profilage réel.

Les lectures de secours de l'interface sont suspendues lorsque la fenêtre est masquée, mais le flux SSE reste ouvert et son observateur backend continue à travailler. Les intervalles de secours sont désormais regroupés dans `lib/live-update-intervals.ts` sans changement de comportement. Aucune fréquence n'a été réduite : les mesures ci-dessus ne permettent pas de conclure sur la charge réelle.

Reste à mesurer sur un environnement dédié avec 1, 10 et 50 projets, actifs et arrêtés, fenêtre visible et masquée, flux SSE connecté et coupé : p50/p95 des requêtes et des actualisations, octets réseau réellement transférés, commandes Docker, CPU et mémoire du backend et du rendu. Docker n'était pas accessible depuis le bac à sable de cet audit. Ne pas créer ou démarrer de projets utilisateurs pour cette mesure sans préparer un environnement isolé. Les mesures du lecteur d'écran et de l'interface restent aussi à réaliser.
