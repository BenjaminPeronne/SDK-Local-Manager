"""Table de routes de l'API locale.

Chaque route associe une méthode HTTP, un gabarit de chemin dans la forme publiée par
/api/capabilities (`/api/projects/{project}/modules`) et la fonction qui la sert. Le gabarit
est la seule écriture du chemin : le routage et le contrat publié ne peuvent plus diverger.
"""

import re
import urllib.parse
from dataclasses import dataclass, field

# Paramètres de chemin reconnus. Un nom de projet est validé par la vue, pas par le motif :
# un nom invalide doit répondre « Nom de projet invalide », pas « Route introuvable ».
PATH_PARAMETERS = {
    "project": r"[^/]+",
    "job": r"[0-9]+",
}

_PARAMETER_RE = re.compile(r"\{([a-z_]+)\}")


def compile_template(template):
    """Motif exact d'un gabarit ; un paramètre inconnu est une erreur de programmation."""
    parts = []
    position = 0
    for match in _PARAMETER_RE.finditer(template):
        name = match.group(1)
        if name not in PATH_PARAMETERS:
            raise ValueError(f"Paramètre de route inconnu : {name}")
        parts.append(re.escape(template[position : match.start()]))
        parts.append(f"(?P<{name}>{PATH_PARAMETERS[name]})")
        position = match.end()
    parts.append(re.escape(template[position:]))
    return re.compile("^" + "".join(parts) + "$")


@dataclass(frozen=True)
class Route:
    method: str
    template: str
    view: object
    # Traduit une exception de la vue en réponse ; reçoit (handler, exception).
    on_error: object
    pattern: re.Pattern = field(init=False, repr=False, compare=False)

    def __post_init__(self):
        object.__setattr__(self, "pattern", compile_template(self.template))


@dataclass(frozen=True)
class RouteRequest:
    """Ce qu'une vue reçoit : le handler HTTP, les paramètres du chemin et ceux de la requête."""

    handler: object
    params: dict
    query: dict

    def param(self, name):
        return urllib.parse.unquote(self.params[name])

    def query_value(self, name, default=""):
        return self.query.get(name, [default])[0]


class Router:
    def __init__(self, routes):
        self.routes = tuple(routes)
        seen = set()
        for route in self.routes:
            key = (route.method, route.template)
            if key in seen:
                raise ValueError(f"Route déclarée deux fois : {route.method} {route.template}")
            seen.add(key)

    def resolve(self, method, path):
        """Route et paramètres du chemin, ou (None, None) si aucune route ne correspond."""
        for route in self.routes:
            if route.method != method:
                continue
            match = route.pattern.match(path)
            if match:
                return route, match.groupdict()
        return None, None

    def templates(self, method, prefix="/api/"):
        """Gabarits servis pour une méthode, dans l'ordre de déclaration."""
        return tuple(
            route.template for route in self.routes if route.method == method and route.template.startswith(prefix)
        )
