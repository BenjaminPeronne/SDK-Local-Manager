# Image de la distribution WSL « SDK-Manager », exportée en fichier .wsl.
#
# Elle n'est jamais exécutée comme conteneur : `docker export` en produit l'archive
# racine, que Windows importe avec `wsl --install --from-file`. Tout ce dont le
# gestionnaire a besoin y est figé et testé en CI : systemd, Docker Engine, Git et SSH.
FROM debian:12-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG SDK_MANAGER_VERSION=0.0.0
# Empreinte de la clé de signature des paquets Docker, publiée sur docs.docker.com. Une clé
# téléchargée qui ne la porte pas arrête la construction : apt ne ferait sinon confiance
# qu'à ce que le serveur a renvoyé.
ARG DOCKER_GPG_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88

# systemd démarre les services de la distribution (Docker) ; iptables est requis par
# Docker sur Debian 12, en mode nft.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dbus \
        git \
        gnupg \
        iproute2 \
        iptables \
        openssh-client \
        procps \
        sudo \
        systemd \
        systemd-sysv \
        tzdata \
        unzip \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && export GNUPGHOME="$(mktemp -d)" \
    && fingerprint="$(gpg --batch --with-colons --show-keys /etc/apt/keyrings/docker.asc | awk -F: '$1 == "fpr" { print $10; exit }')" \
    && rm -rf "$GNUPGHOME" \
    && if [ "$fingerprint" != "$DOCKER_GPG_FINGERPRINT" ]; then echo "Clé GPG de Docker inattendue : $fingerprint" >&2; exit 1; fi \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb

# Utilisateur du poste : uid 1000, membre du groupe docker, sudo sans mot de passe
# pour le dépannage. Le gestionnaire, lui, utilise `wsl -u root` quand il a besoin de droits.
RUN useradd --create-home --shell /bin/bash --uid 1000 sdk \
    && usermod -aG docker sdk \
    && echo "sdk ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/sdk \
    && chmod 0440 /etc/sudoers.d/sdk \
    && mkdir -p /home/sdk/Odoo-projects /home/sdk/.ssh /opt/sdk-manager \
    && chown -R sdk:sdk /home/sdk \
    && chmod 700 /home/sdk/.ssh

COPY wsl.conf /etc/wsl.conf
COPY daemon.json /etc/docker/daemon.json
COPY provision.sh /opt/sdk-manager/provision.sh
# Clés d'hôte vérifiées du GitLab Sudokeys : un faux serveur est refusé dès le premier clone.
COPY known_hosts /etc/ssh/ssh_known_hosts

RUN chmod 0755 /opt/sdk-manager/provision.sh \
    && systemctl enable docker \
    && printf '%s\n' "$SDK_MANAGER_VERSION" > /etc/sdk-manager-release

CMD ["/bin/bash"]
