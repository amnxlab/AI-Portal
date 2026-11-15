#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════
# Post-move check: run this once the uplink changes.
#
#   sudo sh /opt/aiserver/check-move.sh
#
# Everything the portal needs from the outside world, in the order that
# matters, with the fix printed next to anything that fails. Read-only —
# it changes nothing.
# ═══════════════════════════════════════════════════════════════════════
PASS=0
FAIL=0
WARN=0

ok()   { PASS=$((PASS+1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ -n "$2" ] && printf '        → %s\n' "$2"; }
warn() { WARN=$((WARN+1)); printf '  \033[33mWARN\033[0m  %s\n' "$1"; [ -n "$2" ] && printf '        → %s\n' "$2"; }
head2() { printf '\n\033[1m%s\033[0m\n' "$1"; }

head2 '1. The LAN (should be identical — the router did not change)'
IP=$(ip -4 addr show eno1 2>/dev/null | awk '/inet /{print $2}')
GW=$(ip route | awk '/^default/{print $3; exit}')
[ "$IP" = "192.168.1.10/24" ] && ok "address $IP" \
    || bad "address is $IP, expected 192.168.1.10/24" \
           "the static lease moved; check the TP-Link DHCP reservation"
[ "$GW" = "192.168.1.1" ] && ok "gateway $GW" \
    || bad "gateway is $GW, expected 192.168.1.1" "the router's LAN IP changed"

head2 '2. DNS (router-first, so it should follow the new uplink by itself)'
# CoreDNS answers on the LAN address. 127.0.0.1 is systemd-resolved's stub,
# which is not what the network uses and refuses the connection.
DNS=192.168.1.10
# An IPv4 answer, or nothing. `dig +short` prints its errors to stdout, so a
# non-empty result is not the same as a successful lookup.
ip4() { printf '%s' "$1" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; }

for n in portal.lan portal.example.com; do
    R=$(dig +short +time=3 +tries=1 "$n" @$DNS 2>/dev/null | grep -E '^[0-9.]+$' | head -1)
    [ "$R" = "192.168.1.10" ] && ok "$n resolves locally to $R" \
        || bad "$n gave '${R:-no answer}', expected 192.168.1.10" \
               "CoreDNS split-horizon is broken; check /opt/aiserver/dns/Corefile and: docker compose up -d dns"
done
for n in cloudflare.com smtp.gmail.com; do
    R=$(dig +short +time=4 +tries=1 "$n" @$DNS 2>/dev/null | grep -E '^[0-9.]+$' | head -1)
    if ip4 "$R"; then
        ok "$n resolves externally ($R)"
    else
        bad "cannot resolve $n" \
            "campus likely blocks outbound port 53. The router is tried first already; if that fails too, put the campus resolver at the front of the 'forward' line in /opt/aiserver/dns/Corefile and run: docker compose up -d dns"
    fi
done

head2 '3. Outbound SMTP (this is what the task emails depend on)'
python3 - <<'PY'
import socket
for port in (465, 587):
    try:
        s = socket.create_connection(('smtp.gmail.com', port), timeout=8)
        s.close()
        print(f'  \033[32mOK\033[0m    smtp.gmail.com:{port} reachable')
    except Exception as e:
        print(f'  \033[31mFAIL\033[0m  smtp.gmail.com:{port} blocked ({type(e).__name__})')
        print('        → campus is blocking SMTP submission. Assignment emails,')
        print('          password resets and invitations will all fail silently')
        print('          (they retry 6 times, then log). Ask IT for the campus')
        print('          relay and change SMTP_HOST/SMTP_PORT in /opt/aiserver/.env')
PY
# The backend's own verdict carries more weight than a bare socket test.
if docker logs aiserver_backend 2>&1 | grep -q 'SMTP connected'; then
    ok "the backend authenticated to its SMTP server"
elif docker logs aiserver_backend 2>&1 | grep -qi 'SMTP rejected the credentials'; then
    bad "SMTP credentials refused" "Gmail may be challenging the new location — check the portal@example.com account for a security prompt"
else
    warn "the backend has not confirmed SMTP yet" "docker logs aiserver_backend | grep -i smtp"
fi

head2 '4. The Cloudflare tunnel (the only way in from outside)'
if docker logs --since 10m aiserver_cloudflared 2>&1 | grep -q 'Registered tunnel connection'; then
    P=$(docker logs --since 10m aiserver_cloudflared 2>&1 | grep -o 'protocol=[a-z0-9]*' | tail -1 | cut -d= -f2)
    N=$(docker logs --since 10m aiserver_cloudflared 2>&1 | grep -c 'Registered tunnel connection')
    ok "connected — $N connection(s) over ${P:-unknown}"
else
    bad "the tunnel has not registered a connection in the last 10 minutes" \
        "if campus blocks outbound UDP, add TUNNEL_TRANSPORT_PROTOCOL=http2 to /opt/aiserver/.env and run: docker compose up -d cloudflared"
fi

head2 '5. The portal as an origin, from inside the tunnel network'
# cloudflared reaches the portal over the Docker bridge. Port 80 answers
# with a redirect to https://$host (the container name), so the usable
# origins are 443 over TLS, or the frontend/backend containers directly.
NET=$(docker inspect aiserver_cloudflared --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null)
C=$(docker run --rm --network "${NET:-aiserver_default}" curlimages/curl:latest       -sk -o /dev/null -w '%{http_code}' -H 'Host: portal.example.com' https://nginx:443/ 2>/dev/null)
[ "$C" = "200" ] && ok "https://nginx:443/ reachable from the tunnel's network"     || bad "the portal returned '$C' on the tunnel's network" "docker compose ps; docker exec aiserver_nginx nginx -t"

head2 '6. The portal on the LAN (unchanged by the move)'
for p in / /tasks; do
    C=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "https://127.0.0.1$p")
    [ "$C" = "200" ] && ok "https://127.0.0.1$p -> 200" || bad "https://127.0.0.1$p -> $C"
done

head2 '7. Tailscale (how this box is reached for admin)'
if tailscale status >/dev/null 2>&1; then
    SELF=$(tailscale ip -4 2>/dev/null | head -1)
    REL=$(tailscale status 2>/dev/null | grep -c 'relay')
    ok "up as $SELF"
    [ "$REL" -gt 0 ] && warn "$REL peer(s) are going via a DERP relay" \
        "expected behind campus NAT — slower but working; nothing to fix"
else
    bad "tailscale is down" "sudo tailscale up"
fi

head2 '8. Where the world sees us from'
EG=$(curl -s --max-time 10 https://api.ipify.org 2>/dev/null)
if [ -n "$EG" ]; then
    ok "egress IP $EG"
    printf '        → no port forward is needed or used; this is informational.\n'
    printf '          Anything that IP-allowlists this server needs updating.\n'
else
    warn "could not determine the egress IP" "outbound HTTPS to api.ipify.org failed"
fi

head2 '9. Public reachability, forced through the Cloudflare edge'
# From this box portal.example.com resolves to the LAN address on purpose
# (split-horizon), so asking normally would test nginx, not the tunnel.
# Resolving against a public resolver and pinning that address with
# --resolve makes curl take the real outside path.
#
# The probe is a POST to an API route with a cache-busting query string, NOT
# a GET of '/'. Cloudflare still holds cached copies of this site from when
# the hostname worked, and some PoPs serve a cheerful 200 from that cache
# while the origin is in fact answering 404 — which is exactly how this
# check lied the first time it was written. An uncacheable method on an
# uncacheable path cannot be answered from cache, so it reaches whatever the
# origin really is.
#
# The Server header is the tell: the portal behind the tunnel reports
# 'cloudflare'. Anything else named there (Caddy, say) means the hostname is
# pointed at a different origin altogether.
EDGE=$(dig +short +time=4 +tries=1 portal.example.com @1.1.1.1 2>/dev/null | grep -E '^[0-9.]+$' | head -1)
[ -z "$EDGE" ] && EDGE=$(dig +short +time=4 +tries=1 portal.example.com @192.168.1.1 2>/dev/null | grep -E '^[0-9.]+$' | head -1)

if [ -z "$EDGE" ]; then
    warn "could not look up the public address of portal.example.com" \
         "no external resolver answered; see section 2"
else
    printf '        (public DNS says %s)\n' "$EDGE"
    BUST=$(date +%s)$$
    HDRS=$(curl -s -D - -o /dev/null --max-time 20 \
             --resolve "portal.example.com:443:$EDGE" \
             -X POST -H 'Content-Type: application/json' -d '{}' \
             "https://portal.example.com/api/auth/login?cb=$BUST" 2>/dev/null)
    C=$(printf '%s' "$HDRS" | awk 'toupper($1) ~ /^HTTP/ {print $2; exit}')
    SRV=$(printf '%s' "$HDRS" | awk -F': ' 'tolower($1)=="server"{print $2; exit}' | tr -d '\r')
    CACHE=$(printf '%s' "$HDRS" | awk -F': ' 'tolower($1)=="cf-cache-status"{print $2; exit}' | tr -d '\r')

    # 400 is the portal answering: the route exists and refused an empty
    # body. 401 would also be the portal. A 404 from something that is not
    # Cloudflare means this hostname is not ours.
    case "$C" in
      400|401)
        ok "the tunnel is serving portal.example.com (API answered $C via ${SRV:-?})"
        ;;
      404)
        bad "api/auth/login -> 404 (served by ${SRV:-?}${CACHE:+, cache=$CACHE})" \
            "this hostname is not reaching the portal. Cloudflare Zero Trust -> Networks -> Tunnels -> tunnel <your-tunnel-id> -> Public Hostnames: add portal.example.com, Type HTTP, URL nginx:8081. Then make sure the DNS record for 'ai' is the CNAME the dashboard offers, not an A record aimed at the internal proxy."
        ;;
      000|'')
        bad "no response from the Cloudflare edge for portal.example.com" \
            "outbound HTTPS to $EDGE failed, or the edge timed out"
        ;;
      *)
        warn "unexpected status $C from portal.example.com (served by ${SRV:-?})" \
             "neither obviously the portal nor obviously broken - check by hand"
        ;;
    esac

    # A plain GET is reported too, purely so that a stale cached 200 is
    # visible rather than mistaken for success.
    GC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
           --resolve "portal.example.com:443:$EDGE" "https://portal.example.com/?cb=$BUST" 2>/dev/null)
    printf '        (GET / returns %s - ignore it if it disagrees with the line\n' "$GC"
    printf '         above; Cloudflare still has pages cached from when this worked)\n'
fi

printf '\n\033[1m%s\033[0m\n' "── $PASS ok, $WARN warning(s), $FAIL failure(s) ──"
[ "$FAIL" -eq 0 ] && printf 'Nothing blocking.\n' || printf 'Fix the failures above, then run this again.\n'
exit 0
