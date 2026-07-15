#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${1:-https://github.com/kehyvikky001/whatsapp-uptime-bot.git}"
BRANCH="${2:-main}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v rsync >/dev/null || { echo "rsync is required" >&2; exit 1; }

git clone --branch "$BRANCH" "$REPOSITORY" "$WORK_DIR/repository"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude 'data/' \
  --exclude 'node_modules/' \
  "$SOURCE_DIR/" "$WORK_DIR/repository/"

cd "$WORK_DIR/repository"
git add -A
if git diff --cached --quiet; then
  echo "Repository already matches version 2.0.0."
  exit 0
fi

git commit -m "Upgrade WhatsApp uptime bot to production v2"
git push origin "$BRANCH"
echo "Upgrade pushed to $REPOSITORY on $BRANCH."
