"""Contexte TLS du backend empaqueté.

PyInstaller embarque OpenSSL, dont le dossier de certificats par défaut est celui de la machine de build :
absent chez l'utilisateur, toute vérification HTTPS échoue alors avec « unable to get local issuer
certificate ». On complète donc le contexte par défaut (magasin Windows, chemins OpenSSL valides) avec
les certificats racine que le système fournit lui-même.
"""

import os
import ssl

# Jeux de certificats racine publiés par le système, du plus courant au plus rare.
SYSTEM_CA_BUNDLES = (
    "/etc/ssl/cert.pem",  # macOS, Alpine, Arch
    "/etc/ssl/certs/ca-certificates.crt",  # Debian, Ubuntu, image WSL
    "/etc/pki/tls/certs/ca-bundle.crt",  # Fedora, RHEL
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/ssl/ca-bundle.pem",  # openSUSE
)

_context = None


def trusted_ssl_context(bundles=SYSTEM_CA_BUNDLES):
    """Contexte de vérification HTTPS complet, construit une seule fois."""
    global _context
    if _context is not None and bundles is SYSTEM_CA_BUNDLES:
        return _context
    context = ssl.create_default_context()
    sources = [path for path in bundles if os.path.isfile(path)]
    try:
        import certifi  # facultatif : présent seulement si le build l'a embarqué

        sources.append(certifi.where())
    except ImportError:
        pass
    for source in sources:
        try:
            context.load_verify_locations(cafile=source)
        except (OSError, ssl.SSLError):
            continue  # un jeu illisible ne doit pas empêcher d'utiliser les autres
    if bundles is SYSTEM_CA_BUNDLES:
        _context = context
    return context
