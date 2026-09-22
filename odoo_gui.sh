#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "${1:-}" in
  --restart)
    echo "La vue Bootstrap a ete retiree. Redemarrage de l'interface Next..."
    "$SCRIPT_DIR/odoo_next_gui.sh" --stop || true
    exec "$SCRIPT_DIR/odoo_next_gui.sh" --background
    ;;
  --stop)
    exec "$SCRIPT_DIR/odoo_next_gui.sh" --stop
    ;;
esac

echo "La vue Bootstrap a ete retiree."
echo "Lancement de l'interface Next avec ./odoo_next_gui.sh --background"
exec "$SCRIPT_DIR/odoo_next_gui.sh" --background
