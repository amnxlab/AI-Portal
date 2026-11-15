#!/bin/sh
set -e

# SSL is optional — skip the cert check when running in plain HTTP mode.
SSL_DIR="/etc/nginx/ssl"
if [ -f "$SSL_DIR/server.crt" ] && [ -f "$SSL_DIR/server.key" ]; then
    echo "[nginx] ✔  TLS certificate found"
else
    echo "[nginx] ℹ  No TLS certificate at $SSL_DIR/ — running in plain HTTP mode"
fi

exec nginx -g "daemon off;"
