#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${APP_USER:-trainingdb}"
APP_GROUP="${APP_GROUP:-trainingdb}"
APP_DIR="${APP_DIR:-/opt/trainingdb}"
SERVICE_NAME="${SERVICE_NAME:-trainingdb.service}"
BRANCH="${BRANCH:-main}"
FIX_OWNERSHIP="${FIX_OWNERSHIP:-1}"

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

run_as_app() {
  sudo -u "$APP_USER" -H bash -lc "$*"
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0"
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Git repo not found at $APP_DIR"
  exit 1
fi

if ! systemctl list-unit-files | grep -q "^${SERVICE_NAME}"; then
  echo "Service unit not found: ${SERVICE_NAME}"
  exit 1
fi

log "Stopping ${SERVICE_NAME}"
systemctl stop "$SERVICE_NAME"

if [[ "$FIX_OWNERSHIP" == "1" ]]; then
  current_owner="$(stat -c '%U:%G' "$APP_DIR")"
  expected_owner="${APP_USER}:${APP_GROUP}"
  if [[ "$current_owner" != "$expected_owner" ]]; then
    log "Fixing ownership on ${APP_DIR} (${current_owner} -> ${expected_owner})"
    chown -R "${APP_USER}:${APP_GROUP}" "$APP_DIR"
  fi
fi

log "Configuring git safe.directory for ${APP_USER}"
run_as_app "git config --global --add safe.directory '$APP_DIR'"

log "Stashing local changes if present"
run_as_app "cd '$APP_DIR' && if [[ -n \"\$(git status --porcelain)\" ]]; then git stash push -u -m 'server-pre-update-\$(date +%F-%H%M%S)'; fi"

log "Fetching and pulling latest ${BRANCH}"
run_as_app "cd '$APP_DIR' && git fetch origin && git pull --rebase origin '$BRANCH'"

log "Installing production dependencies"
run_as_app "cd '$APP_DIR' && npm ci --omit=dev"

log "Restarting ${SERVICE_NAME}"
systemctl restart "$SERVICE_NAME"

log "Service status"
systemctl status "$SERVICE_NAME" --no-pager -l

log "Recent logs"
journalctl -u "$SERVICE_NAME" -n 80 --no-pager

log "Update complete"