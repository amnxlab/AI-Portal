#!/usr/bin/env bash
# stop-dev.sh — kill the background dev server started by connect.sh / start-dev.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${AI_SERVER_RUNTIME_DIR:-/tmp/portal-host-runtime}"
USER_RUNTIME_DIR="/tmp/portal-host-runtime-${USER:-$(id -u)}"
PID_FILE_ROOT="$ROOT/.dev-server.pid"
PID_FILE_RUNTIME="$RUNTIME_DIR/dev-server.pid"
PID_FILE_USER_RUNTIME="$USER_RUNTIME_DIR/dev-server.pid"
WATCHDOG_FILE_ROOT="$ROOT/.postgres-watchdog.pid"
WATCHDOG_FILE_RUNTIME="$RUNTIME_DIR/postgres-watchdog.pid"
WATCHDOG_FILE_USER_RUNTIME="$USER_RUNTIME_DIR/postgres-watchdog.pid"

YLW="\033[0;33m"; GRN="\033[0;32m"; RST="\033[0m"
log()  { echo -e "${GRN}[stop]${RST} $*"; }
warn() { echo -e "${YLW}[stop]${RST} $*"; }

# ── kill watchdog ────────────────────────────────────────────
for WATCHDOG_FILE in "$WATCHDOG_FILE_ROOT" "$WATCHDOG_FILE_RUNTIME" "$WATCHDOG_FILE_USER_RUNTIME"; do
  if [ -f "$WATCHDOG_FILE" ]; then
    WPID=$(cat "$WATCHDOG_FILE" 2>/dev/null || true)
    if [ -n "$WPID" ] && kill -0 "$WPID" 2>/dev/null; then
      warn "Killing postgres watchdog (PID $WPID)…"
      kill "$WPID" 2>/dev/null || true
    fi
    rm -f "$WATCHDOG_FILE"
  fi
done

# ── kill by saved PID ─────────────────────────────────────────
for PID_FILE in "$PID_FILE_ROOT" "$PID_FILE_RUNTIME" "$PID_FILE_USER_RUNTIME"; do
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      warn "Killing dev server (PID $PID)…"
      kill "$PID" 2>/dev/null || true
      sleep 2
    fi
    rm -f "$PID_FILE"
  fi
done

# ── belt-and-suspenders: free the ports ──────────────────────
for PORT in 5173 4000; do
  PORT_PID=$(fuser "${PORT}/tcp" 2>/dev/null || true)
  if [ -n "$PORT_PID" ]; then
    warn "Freeing port $PORT (PID $PORT_PID)…"
    fuser -k "${PORT}/tcp" 2>/dev/null || true
  fi
done

# ── stop postgres container ───────────────────────────────────
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'aiserver_postgres'; then
  warn "Stopping postgres container…"
  docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.dev.yml" \
    stop postgres 2>/dev/null || true
fi

log "Dev server stopped ✓"
