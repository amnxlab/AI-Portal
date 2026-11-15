#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  AI-Server — Development Startup Script
#  Starts PostgreSQL via Docker, then NestJS + Vite on the host.
#
#  Usage:  ./start-dev.sh          (foreground, Ctrl+C to stop)
#          ./connect.sh            (background, keeps running)
# ─────────────────────────────────────────────────────────────
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
  WATCHDOG_FILE="$RUNTIME_DIR/postgres-watchdog.pid"
else
  WATCHDOG_FILE="$ROOT/.postgres-watchdog.pid"
fi

# Launcher executes this script via non-interactive SSH, which may not load
# user shell init files. Ensure common bin paths are present before checks.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin:$HOME/bin:$PATH"

bootstrap_node_runtime() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  # Try loading NVM for shells started without profile initialization.
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    if [ -f "$ROOT/.nvmrc" ]; then
      nvm use --silent >/dev/null 2>&1 || true
    fi
  fi
}

bootstrap_node_runtime

# These must exist before the trap fires so cleanup never references unbound vars
BACKEND_PID=""
FRONTEND_PID=""

# ── colours ──────────────────────────────────────────────────
GRN="\033[0;32m"
YLW="\033[0;33m"
CYN="\033[0;36m"
RED="\033[0;31m"
RST="\033[0m"

log()  { echo -e "${GRN}[AI-Server]${RST} $*"; }
warn() { echo -e "${YLW}[WARN]${RST} $*"; }
err()  { echo -e "${RED}[ERROR]${RST} $*"; exit 1; }

# ── pre-flight checks ────────────────────────────────────────
command -v docker >/dev/null 2>&1 || err "Docker is not installed."
docker compose version >/dev/null 2>&1 \
  || command -v docker-compose >/dev/null 2>&1 \
  || err "docker compose is not installed."
command -v node >/dev/null 2>&1 || err "Node.js is not installed."
command -v npm >/dev/null 2>&1 || err "npm is not installed."

# Detect compose command (v2 plugin vs v1 standalone)
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
else
  COMPOSE="docker-compose -f docker-compose.yml -f docker-compose.dev.yml"
fi

postgres_ready() {
  # Preferred path: talk to the compose service directly.
  if (cd "$ROOT" && $COMPOSE exec -T postgres pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1); then
    return 0
  fi

  # Backward-compatible fallbacks for environments that still use direct docker exec.
  if docker exec aiserver_postgres pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
    return 0
  fi

  ALT_POSTGRES_NAME=$(docker ps --format '{{.Names}}' | grep -E '(^|_)aiserver_postgres$' | head -n 1 || true)
  if [ -n "$ALT_POSTGRES_NAME" ] && docker exec "$ALT_POSTGRES_NAME" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

# ── install dependencies if needed ───────────────────────────
if [ ! -d "$ROOT/backend/node_modules" ]; then
  log "Installing backend dependencies…"
  (cd "$ROOT/backend" && npm install --silent)
fi

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  log "Installing frontend dependencies…"
  (cd "$ROOT/frontend" && npm install --silent)
fi

# ── ensure upload / documents directories exist ───────────────
# These mirror the volumes mounted in docker-compose.yml for production.
DOCS_PATH="/workspace/documentations"
UPLOAD_PATH="$ROOT/uploads"

for DIR in \
    "$DOCS_PATH" \
    "$DOCS_PATH/manuals" \
    "$DOCS_PATH/files" \
    "$DOCS_PATH/tickets" \
    "$UPLOAD_PATH"; do
  if [ ! -d "$DIR" ]; then
    log "Creating directory: $DIR"
    mkdir -p "$DIR"
  fi
done

# ── dev environment variables ─────────────────────────────────
# Override Docker-specific values so the native NestJS process
# can reach the DB exposed on localhost by docker-compose.dev.yml.
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=aiserver
export POSTGRES_PASSWORD=changeme
export POSTGRES_DB=aiserver_db
export NODE_ENV=development
export PORT=4000
export FRONTEND_URL=http://localhost:5173

# Discord webhook — used by the task-assignment notifier.
# Falls back to the shared lab channel; override in .env or the environment.
export DISCORD_WEBHOOK_TASKS="${DISCORD_WEBHOOK_TASKS:-https://discord.com/api/webhooks/000000000000000000/REPLACE_WITH_YOUR_WEBHOOK}"

# Tell the backend where uploaded documents/manuals/tickets live
export DOCUMENTS_PATH="$DOCS_PATH"

# Auto-create .env from .env.example if it doesn't exist.
# Production `docker compose up` requires it; dev sets most vars inline above.
if [ ! -f "$ROOT/.env" ] && [ -f "$ROOT/.env.example" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  warn ".env was missing — copied from .env.example. Review JWT secrets before production use."
fi

# Load remaining vars from .env (JWT secrets, Discord webhooks, etc.)
# Variables already exported above are NOT overridden.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^\s*#' "$ROOT/.env" | grep -v '^\s*$' | \
    grep -v '^POSTGRES_HOST=' | grep -v '^POSTGRES_PORT=' | \
    grep -v '^POSTGRES_USER=' | grep -v '^POSTGRES_PASSWORD=' | \
    grep -v '^POSTGRES_DB='   | grep -v '^NODE_ENV='         | \
    grep -v '^PORT='          | grep -v '^FRONTEND_URL='     | \
    grep -v '^DOCUMENTS_PATH=')
  set +a
fi

# ── port collision guards ─────────────────────────────────────
for CHECK_PORT in 4000 5173 5174 5175; do
  PID=$(fuser "${CHECK_PORT}/tcp" 2>/dev/null || true)
  if [ -n "$PID" ]; then
    warn "Port ${CHECK_PORT} in use by PID ${PID} — killing…"
    fuser -k "${CHECK_PORT}/tcp" 2>/dev/null || true
    # Wait until the port is actually free (up to 3 s)
    WAIT=0
    while fuser "${CHECK_PORT}/tcp" >/dev/null 2>&1; do
      WAIT=$((WAIT + 1))
      [ "$WAIT" -ge 6 ] && break
      sleep 0.5
    done
  fi
done

# ── start PostgreSQL only ────────────────────────────────────
log "Starting PostgreSQL container…"
(cd "$ROOT" && $COMPOSE up -d postgres)

log "Waiting for PostgreSQL to be healthy…"
TRIES=0
until postgres_ready; do
  TRIES=$((TRIES + 1))
  [ "$TRIES" -ge 30 ] && err "PostgreSQL did not become ready in 30 seconds."
  sleep 1
done
log "PostgreSQL is ready ✓"

# ── cleanup on exit ───────────────────────────────────────────
cleanup() {
  echo
  warn "Shutting down dev servers…"
  # Kill watchdog first so it doesn't restart postgres after we stop it
  if [ -f "$WATCHDOG_FILE" ]; then
    WPID=$(cat "$WATCHDOG_FILE" 2>/dev/null || true)
    [ -n "$WPID" ] && kill "$WPID" 2>/dev/null || true
    rm -f "$WATCHDOG_FILE"
  fi
  for CPID in "$BACKEND_PID" "$FRONTEND_PID"; do
    if [ -n "$CPID" ]; then
      PGID=$(ps -o pgid= -p "$CPID" 2>/dev/null | tr -d ' ') || true
      [ -n "$PGID" ] && [ "$PGID" != "0" ] && kill -- "-$PGID" 2>/dev/null || true
      kill "$CPID" 2>/dev/null || true
      pkill -P "$CPID" 2>/dev/null || true
    fi
  done
  fuser -k 4000/tcp 2>/dev/null || true
  fuser -k 5173/tcp 2>/dev/null || true
  (cd "$ROOT" && $COMPOSE stop postgres) 2>/dev/null || true
  log "Stopped ✓"
}
trap cleanup EXIT INT TERM

# ── start NestJS backend ──────────────────────────────────────
log "Starting NestJS backend (http://localhost:4000/api)…"
(cd "$ROOT/backend" && npm run start:dev 2>&1 | sed "s/^/${CYN}[backend]${RST} /") &
BACKEND_PID=$!

log "Waiting for backend to accept connections on :4000…"
BACKEND_WAIT=0
until curl -s --max-time 2 http://127.0.0.1:4000/api >/dev/null 2>&1; do
  BACKEND_WAIT=$((BACKEND_WAIT + 1))
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    err "Backend process exited before becoming ready."
  fi
  [ "$BACKEND_WAIT" -ge 60 ] && err "Backend did not become ready on :4000 in 60 seconds."
  sleep 1
done
log "Backend is ready ✓"

# ── postgres watchdog (background) ───────────────────────────
# Checks every 20 s; restarts postgres automatically if it goes down.
_postgres_watchdog() {
  while true; do
    sleep 20
    if ! postgres_ready; then
      echo -e "${YLW}[WARN]${RST} PostgreSQL is down — restarting…"
      (cd "$ROOT" && $COMPOSE up -d postgres) >/dev/null 2>&1 || true
      local TRIES=0
      until postgres_ready; do
        TRIES=$((TRIES + 1))
        [ "$TRIES" -ge 30 ] && break
        sleep 1
      done
      if postgres_ready; then
        echo -e "${GRN}[AI-Server]${RST} PostgreSQL restarted and healthy ✓"
      else
        echo -e "${YLW}[WARN]${RST} PostgreSQL failed to restart — check Docker logs"
      fi
    fi
  done
}
_postgres_watchdog &
echo $! > "$WATCHDOG_FILE"
chmod 664 "$WATCHDOG_FILE" 2>/dev/null || true

# ── start Vite frontend ───────────────────────────────────────
export VITE_API_URL=/api
export VITE_SOCKET_URL=http://localhost:5173

log "Starting Vite frontend (http://localhost:5173)…"
(cd "$ROOT/frontend" && npm run dev 2>&1 | sed "s/^/${YLW}[frontend]${RST} /") &
FRONTEND_PID=$!

echo
echo -e "${GRN}╔══════════════════════════════════════════════════════════════╗${RST}"
echo -e "${GRN}║            AI-Server  ·  Dev Environment                      ║${RST}"
echo -e "${GRN}╠══════════════════════════════════════════════════════════════╣${RST}"
echo -e "${GRN}║  Portal  →  http://localhost:5173                            ║${RST}"
echo -e "${GRN}║  API     →  http://localhost:5173/api  (Vite proxy → :4000)  ║${RST}"
echo -e "${GRN}╠══════════════════════════════════════════════════════════════╣${RST}"
echo -e "${GRN}║  Documents  →  $DOCS_PATH${RST}"
echo -e "${GRN}║  Uploads    →  $UPLOAD_PATH${RST}"
echo -e "${GRN}╚══════════════════════════════════════════════════════════════╝${RST}"
echo

# ── wait until both processes finish ─────────────────────────
# Use set +e so Ctrl+C (SIGINT) doesn't bypass the EXIT trap
set +e
wait "$BACKEND_PID" "$FRONTEND_PID"
