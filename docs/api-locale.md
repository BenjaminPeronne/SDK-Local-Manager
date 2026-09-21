# API locale du gestionnaire

Le backend de SDK Local Manager expose une API HTTP sur la boucle locale. L'interface de
l'application l'utilise, et tout outil lancé sur le même poste peut en faire autant : script,
commande de recette, extension.

Cette page s'adresse aux intégrateurs. Elle décrit comment découvrir ce que le gestionnaire
sait faire, comment lancer une action et la suivre, et ce qui est garanti d'une version à l'autre.

## Adresse

- `http://127.0.0.1:18765` par défaut.
- Le port se règle dans les paramètres (`api_port` dans `config.json`). S'il est occupé au
  démarrage, l'application en choisit un autre. `/api/health` renvoie le port réellement utilisé.
- L'API n'écoute que sur `127.0.0.1` : elle n'est jamais joignable depuis une autre machine.

## Règles d'accès

L'API n'a pas d'authentification. Elle se protège des pages web ouvertes dans un navigateur, qui
pourraient sinon l'appeler à la place de l'utilisateur.

| Règle | Sinon |
| --- | --- |
| L'en-tête `Host` désigne la boucle locale (`127.0.0.1`, `localhost`, `::1`). | `403` |
| Un en-tête `Origin`, s'il est présent, est celui de l'application. Un script local n'en envoie pas. | `403` |
| Un corps de requête est en `Content-Type: application/json`. | `400` |

`curl` et les clients HTTP usuels respectent ces règles sans réglage.

## Découvrir le gestionnaire

Un intégrateur interroge ces deux routes avant tout autre appel. Elles ne sondent ni Docker ni
WSL : elles répondent immédiatement.

### `GET /api/version`

```bash
curl -s http://127.0.0.1:18765/api/version
```

```json
{ "application": "0.6.0", "api": 1, "instance_id": "…" }
```

- `application` : version de l'application, au format `MAJEUR.MINEUR.CORRECTIF`.
- `api` : version du contrat décrit plus bas.
- `instance_id` : identifiant de l'instance en cours, attribué par l'application à chaque démarrage.
  Il est vide quand le backend est lancé seul, hors de l'application.

### `GET /api/capabilities`

```bash
curl -s http://127.0.0.1:18765/api/capabilities
```

```json
{
  "application": "0.6.0",
  "api": 1,
  "instance_id": "…",
  "endpoints": {
    "GET": ["/api/version", "/api/capabilities", "/api/health", "/api/projects/{project}/modules", "…"],
    "POST": ["/api/jobs", "/api/jobs/{job}/cancel", "…"],
    "DELETE": ["/api/errors", "/api/jobs", "/api/jobs/{job}"]
  },
  "actions": ["cleanup_staging", "create_database", "install_module", "start_project", "…"],
  "features": {
    "platform": "macos",
    "execution_mode": "native",
    "job_cancellation": true,
    "job_queue": true
  }
}
```

- `endpoints` : routes servies, par méthode. `{project}` est un nom de projet, `{job}` un
  identifiant d'action.
- `actions` : valeurs acceptées par `POST /api/jobs`.
- `features.platform` : `macos`, `linux` ou `windows`. Sous Windows, le backend peut tourner
  dans l'environnement Linux du gestionnaire : `execution_mode` le précise.

## Compatibilité

`api` ne change que si une route ou une action publiée **disparaît ou change de forme**. Un ajout
ne la change pas. Un intégrateur :

1. vérifie que `api` vaut la version pour laquelle il a été écrit, et s'arrête avec un message
   clair sinon ;
2. vérifie qu'une action figure dans `actions` avant de l'appeler, plutôt que de supposer qu'elle
   existe dans la version installée.

Le contrat publié ne peut pas s'écarter du code sans que les tests échouent :
`tests/test_web_runtime.py` compare `actions` et `endpoints` aux actions et aux routes réellement
servies, et `/api/version` à la version des manifestes de l'application.

## Lancer une action et la suivre

### Créer

```bash
curl -s -X POST http://127.0.0.1:18765/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"action": "start_project", "project": "DEMO"}'
```

Réponse `201` :

```json
{
  "job": {
    "id": 12,
    "title": "Démarrer DEMO",
    "project": "DEMO",
    "status": "queued",
    "started_at": "…",
    "lines": [],
    "cancellable": true,
    "cancel_hint": "…",
    "cancel_blocked_step": "",
    "cancel_pending_step": "",
    "waiting_for": "…"
  }
}
```

Les paramètres dépendent de l'action : `project`, `db`, `modules`… Une valeur invalide ou une
action inconnue renvoie `400` avec `{"error": "…"}`.

Les actions d'un même projet s'exécutent l'une après l'autre : une action lancée pendant qu'une
autre tourne sur le projet est mise en file (`queued`), et `waiting_for` dit laquelle elle attend.

### Suivre

```bash
curl -s 'http://127.0.0.1:18765/api/jobs?detail=12'
```

La réponse `{"jobs": [...]}` liste les 30 dernières actions. Seule l'action désignée par
`detail=<id>` porte sa sortie (`output`) ; sans ce paramètre, c'est la plus récente.

- `output_total` compte les caractères produits depuis le début de l'action.
- `output_from=<n>` ne renvoie que la suite, après le caractère `n` : passer l'`output_total` de
  la réponse précédente pour relire au fil de l'eau. Si la réponse porte `output_from: 0`, le
  début demandé n'est plus conservé et `output` contient toute la sortie retenue : la remplacer
  plutôt que la compléter.
- `progress`, quand il est présent, donne l'avancement chiffré : `{"label", "current", "total"}`.

Statuts :

| Statut | Signification |
| --- | --- |
| `queued` | En attente d'une autre action du même projet. |
| `running` | En cours. |
| `cancelling` | Arrêt demandé, retour arrière en cours. |
| `done` | Terminée avec succès. |
| `error` | Terminée en échec. |
| `cancelled` | Arrêtée, modifications annulées. |

### Arrêter

```bash
curl -s -X POST http://127.0.0.1:18765/api/jobs/12/cancel -H 'Content-Type: application/json' -d '{}'
```

Une étape irréversible ne peut pas être interrompue : la réponse est alors `409`, et
`cancel_blocked_step` nomme l'étape en cours. Renvoient aussi `409` : une action inconnue, déjà
terminée, ou qu'on ne peut pas arrêter du tout (`cancellable: false`, raison dans `cancel_hint`).
Une action en file (`queued`) est retirée de la file sans avoir démarré.

## Ajouter une action ou une route

Pour un contributeur du gestionnaire :

1. ajouter la branche dans le répartiteur de `POST /api/jobs`, ou la route dans le gestionnaire HTTP ;
2. la déclarer dans `API_ACTIONS` ou `API_ENDPOINTS` (`odoo_manager_web.py`) ;
3. si une action ou une route existante disparaît ou change de forme, incrémenter `API_VERSION`.

Oublier l'étape 2 fait échouer `tests/test_web_runtime.py`.
