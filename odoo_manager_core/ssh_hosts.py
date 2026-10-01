"""Clés d'hôte SSH du GitLab Sudokeys, figées dans l'application.

Git se connecte avec `StrictHostKeyChecking=accept-new` : un hôte inconnu est accepté au
premier contact. Inscrire ces clés avant tout clone fait de gitlab.sudokeys.com un hôte
connu : un faux serveur, sur un réseau hostile, est alors refusé au lieu d'être mémorisé.

Empreintes (SHA256), relevées le 2026-10-01 et identiques à celles d'un poste déjà appairé :
  ED25519 yhw+FpXgJMy4O2alXkeZ57f9WiwQMIpYvcSwnkkxRgU
  ECDSA   eVLtnnnXViNZKpAfnMULu+b6KTdgyb4Ql13n2+Xnugs
  RSA     JjTTeA+9fM32kzFyNVYC65kIEb5kat1XxpCrJCkJMis

Les mêmes lignes sont livrées dans l'environnement Linux de Windows (wsl/known_hosts).
"""

from pathlib import Path

GITLAB_HOST_KEYS = (
    "[gitlab.sudokeys.com]:10022 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFygfAICQxQ0QH1ARKo7hfWXtI5hRgWh/FpG2tc5Aw+m",
    "[gitlab.sudokeys.com]:10022 ecdsa-sha2-nistp256 "
    "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBLsAdl2DwVv+d6cJIXfAjgLm4bxbd9Di0nhJ1ZM8GqAwxoxnx3zMcVWTYsoLvOQrYh6anQ2dojxdkXz67NO0Pto=",
    "[gitlab.sudokeys.com]:10022 ssh-rsa "
    "AAAAB3NzaC1yc2EAAAADAQABAAABAQDYsC+A5dQL71YHu3oavBPuLeNyQoZ3duu6iSZfRdk3w2HOxLaD6LDhP1mhk130YRw1DV6xwzMmmEVg"
    "biRZBHvbVKAjCu8+n5Tk0/SGEfFTzUQCVo+69NcmG15Ql/6dbLTF+2B+PxJ2Y02OddmxwafXr3PACOmq8sdKTbnObmqBE4L7Q84OihAX/m2C"
    "0i5BDIr6SA2jjvgaS+rlkBoZ02gNz9ZG03Y1aPmKZnaUL5a8MW7LbkRkoLGOfGvT4xyu+bHadI2yI5MRBkoWdnGzEQwoBLPH9qgrcngpsv6P"
    "8v1qfF2SdIEMJdKF2T9DgO+OuvunNGpifsolqABxc6UArs99",
)


def ensure_pinned_host_keys(home=None):
    """Ajoute à ~/.ssh/known_hosts les clés GitLab qui n'y figurent pas encore.

    La présence est testée sur la clé elle-même, qui reste lisible quand ssh hache les noms
    d'hôtes (HashKnownHosts, par défaut sous Debian et Ubuntu). Rien n'est retiré du fichier.
    Retourne le nombre de clés ajoutées ; une erreur d'écriture n'empêche pas de démarrer.
    """
    ssh_dir = Path(home or Path.home()) / ".ssh"
    known_hosts = ssh_dir / "known_hosts"
    try:
        current = known_hosts.read_text(encoding="utf-8", errors="ignore") if known_hosts.exists() else ""
        missing = [line for line in GITLAB_HOST_KEYS if line.rsplit(" ", 1)[1] not in current]
        if not missing:
            return 0
        ssh_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        prefix = "" if not current or current.endswith("\n") else "\n"
        with known_hosts.open("a", encoding="utf-8") as output:
            output.write(prefix + "".join(line + "\n" for line in missing))
        return len(missing)
    except OSError:
        return 0
