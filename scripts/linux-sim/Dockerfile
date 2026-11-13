# Poste Linux simulé : moteur Docker natif (pas de VM entre le backend et ses conteneurs),
# disque Linux, backend lancé depuis les sources montées en lecture seule sur /app, par un
# compte ordinaire du groupe docker comme chez un utilisateur Linux réel (pas root).
FROM docker:29-dind
RUN apk add --no-cache python3 git openssh-client bash curl procps coreutils findmnt lsblk su-exec \
 && (addgroup -S docker 2>/dev/null || true) \
 && adduser -D -u 1000 dev && addgroup dev docker \
 && mkdir -p /home/dev/.config/sdk-sim /home/dev/odoo-projects \
 && echo '{"workspace": "/home/dev/odoo-projects"}' > /home/dev/.config/sdk-sim/config.json \
 && chown -R dev:dev /home/dev
ENV ODOO_MANAGER_CONFIG_DIR=/home/dev/.config/sdk-sim \
    ODOO_GUI_HOST=0.0.0.0 \
    ODOO_GUI_PORT=18799
