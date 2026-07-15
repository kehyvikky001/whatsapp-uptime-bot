#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/whatsapp-uptime-bot-$STAMP.tar.gz"
mkdir -p "$BACKUP_DIR"

was_running=false
if docker compose ps --status running --services | grep -qx app; then
  was_running=true
  docker compose stop app
fi

cleanup() {
  if [ "$was_running" = true ]; then
    docker compose start app >/dev/null
  fi
}
trap cleanup EXIT

docker compose run --rm --no-deps --entrypoint sh app -c \
  'tar -C /app/data -czf - .' > "$TARGET"
chmod 600 "$TARGET"
sha256sum "$TARGET" > "$TARGET.sha256"
chmod 600 "$TARGET.sha256"

echo "Encrypted data backup created: $TARGET"
echo "Back up SESSION_ENCRYPTION_KEY separately; the archive cannot be restored without it."
