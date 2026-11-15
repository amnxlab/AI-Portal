#!/usr/bin/env bash
# connect.sh — attach to the shared dev server (start it if needed).
#
#   ./connect.sh           → join the already-running server, or start one
#   ./connect.sh --restart → force-kill the current server and relaunch
#
# Multiple users can run this safely:
#   • If the server is already up on :5173, everyone gets the URL immediately.
#   • Only the first person (or --restart) actually launches the process.
#
# Logs:  tail -f "$ROOT/dev-server.log"
# Stop:  ./stop-dev.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${AI_SERVER_RUNTIME_DIR:-/tmp/portal-host-runtime}"
FORCE_RUNTIME_STATE="${AI_SERVER_FORCE_RUNTIME_STATE:-0}"

resolve_runtime_dir() {
  local candidate="$1"
  local fallback="/tmp/portal-host-runtime-${USER:-$(id -u)}"

  mkdir -p "$candidate" 2>/dev/null || true
  chmod 0777 "$candidate" 2>/dev/null || true
  if [ -d "$candidate" ] && [ -w "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi

  mkdir -p "$fallback" 2>/dev/null || true
  chmod 0700 "$fallback" 2>/dev/null || true
  if [ -d "$fallback" ] && [ -w "$fallback" ] && [ -x "$fallback" ]; then
    printf '%s' "$fallback"
    return 0
  fi

  printf '%s' "$candidate"
}

if [ "$FORCE_RUNTIME_STATE" = "1" ] || [ ! -w "$ROOT" ]; then
  RUNTIME_DIR="$(resolve_runtime_dir "$RUNTIME_DIR")"
  LOG="$RUNTIME_DIR/dev-server.log"
  PID_FILE="$RUNTIME_DIR/dev-server.pid"
  WATCHDOG_FILE="$RUNTIME_DIR/postgres-watchdog.pid"
else
  LOG="$ROOT/dev-server.log"
  PID_FILE="$ROOT/.dev-server.pid"
  WATCHDOG_FILE="$ROOT/.postgres-watchdog.pid"
fi

# Propagate runtime state directory to start-dev.sh
export AI_SERVER_RUNTIME_DIR="$RUNTIME_DIR"
export AI_SERVER_FORCE_RUNTIME_STATE="$FORCE_RUNTIME_STATE"

# If previous runs created state files we cannot write, remove and recreate them.
# In a writable shared directory this keeps cross-user startup reliable.
for STATE_FILE in "$LOG" "$PID_FILE" "$WATCHDOG_FILE"; do
  if [ -f "$STATE_FILE" ] && [ ! -w "$STATE_FILE" ]; then
    rm -f "$STATE_FILE" 2>/dev/null || true
  fi
done

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose -f $ROOT/docker-compose.yml -f $ROOT/docker-compose.dev.yml"
else
  COMPOSE="docker-compose -f $ROOT/docker-compose.yml -f $ROOT/docker-compose.dev.yml"
fi

GRN="\033[0;32m"; YLW="\033[0;33m"; CYN="\033[0;36m"; RST="\033[0m"
log()  { echo -e "${GRN}[connect]${RST} $*"; }
warn() { echo -e "${YLW}[connect]${RST} $*"; }
info() { echo -e "${CYN}[connect]${RST} $*"; }

postgres_ready() {
  if (cd "$ROOT" && $COMPOSE exec -T postgres pg_isready -U aiserver >/dev/null 2>&1); then
    return 0
  fi

  if docker exec aiserver_postgres pg_isready -U aiserver >/dev/null 2>&1; then
    return 0
  fi

  ALT_POSTGRES_NAME=$(docker ps --format '{{.Names}}' | grep -E '(^|_)aiserver_postgres$' | head -n 1 || true)
  if [ -n "$ALT_POSTGRES_NAME" ] && docker exec "$ALT_POSTGRES_NAME" pg_isready -U aiserver >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

FORCE_RESTART=false
for arg in "$@"; do
  [[ "$arg" == "--restart" || "$arg" == "-r" ]] && FORCE_RESTART=true
done

# ── helper: print the ready banner ───────────────────────────
print_ready() {
  echo
  echo -e "${GRN}  ✅  Dev server is running${RST}"
  echo -e "  👉  http://localhost:5173       ← your local browser (VS Code port-forward)"
  echo -e "  👉  http://127.0.0.1:5173      ← same server, direct"
  echo
  echo -e "  Multiple users can connect simultaneously via VS Code port forwarding."
  echo -e "  Each person's VS Code will tunnel :5173 to their own localhost."
  echo
  echo -e "  Logs:  tail -f $LOG"
  echo -e "  Stop:  ./stop-dev.sh"
  echo
}

# ── if already up and not forcing restart → just show URL ────
if ! $FORCE_RESTART && curl -s --max-time 2 http://127.0.0.1:5173 > /dev/null 2>&1; then
  info "Server already running on :5173 — no changes made."
  # Ensure postgres is healthy even if Vite is up
  if ! postgres_ready; then
    warn "PostgreSQL is down — restarting…"
    (cd "$ROOT" && $COMPOSE up -d postgres) >/dev/null 2>&1 || true
    TRIES=0
    until postgres_ready; do
      TRIES=$((TRIES + 1))
      [ "$TRIES" -ge 20 ] && break
      sleep 1
    done
    if postgres_ready; then
      log "PostgreSQL restarted and healthy ✓"
    else
      warn "PostgreSQL may still be starting — check: tail -f $LOG"
    fi
  fi
  print_ready
  exit 0
fi

# ── forced restart (or first launch): kill existing instance ─
if $FORCE_RESTART; then
  warn "Force-restart requested…"
fi

if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    warn "Stopping existing dev server (PID $OLD_PID)…"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
  rm -f "$PID_FILE"
fi

# Belt-and-suspenders: free the ports
for PORT in 5173 4000; do
  PID=$(fuser "${PORT}/tcp" 2>/dev/null || true)
  if [ -n "$PID" ]; then
    warn "Freeing port $PORT (PID $PID)…"
    fuser -k "${PORT}/tcp" 2>/dev/null || true
    sleep 1
  fi
done

# ── launch start-dev.sh in background ────────────────────────
log "Starting dev server in background…"
log "Logs → $LOG"

# Harden sensitive files — group (aiteam) can read, others cannot
chmod 640 "$ROOT/.env" "$LOG" 2>/dev/null || true

# Remove stale pid file to avoid redirection failures on non-writable leftovers.
rm -f "$PID_FILE" 2>/dev/null || true

# Use group-friendly umask for shared startup state files.
( umask 002 && nohup bash "$ROOT/start-dev.sh" > "$LOG" 2>&1 & echo $! > "$PID_FILE" )
chmod 664 "$PID_FILE" "$LOG" 2>/dev/null || true
log "PID → $(cat "$PID_FILE")"
START_PID="$(cat "$PID_FILE")"

# ── wait for Vite to be ready ─────────────────────────────────
echo
log "Waiting for server on :5173…"
ELAPSED=0
until curl -s --max-time 2 http://127.0.0.1:5173 > /dev/null 2>&1; do
  if ! kill -0 "$START_PID" 2>/dev/null; then
    warn "Dev server process exited before :5173 became ready."
    warn "Last startup logs:"
    tail -n 80 "$LOG" || true
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ "$ELAPSED" -ge 180 ]; then
    warn "Timed out after 180s. Check logs:"
    warn "  tail -f $LOG"
    tail -n 80 "$LOG" || true
    exit 1
  fi
done

print_ready
