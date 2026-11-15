# Moving the server to another ISP

Written for whoever physically moves the machine. It assumes the server and
its router travel together and are plugged into a different internet
connection at the other end.

The short version: **there is almost nothing to do.** This page says why, and
covers the cases where that is not quite true.

---

## Why no port forwarding is needed, at any site

The portal is published through a **Cloudflare Tunnel**. `cloudflared` runs
beside the other containers and dials *outbound*; requests for the public
hostname arrive at Cloudflare's edge and come back down that connection.

Nothing listens for inbound connections from the internet, so there is no
port to forward, no firewall rule to recreate and no dynamic-DNS record to
update. It works behind CGNAT, behind a captive-portal router, and on a
campus network that blocks inbound traffic entirely — all of which defeat a
port forward.

The tunnel is **token-based**: its configuration lives in the Cloudflare
dashboard, not in a credentials file on disk, so the move carries nothing.
The public DNS record points at Cloudflare, not at the site, so it never
changes either.

---

## What has to be true at the new site

**1. Outbound HTTPS must work.** `cloudflared` reaches Cloudflare on 443,
preferring QUIC over UDP and falling back to TCP. Any ordinary connection
satisfies this.

**2. The LAN addressing must match `.env`.** The server holds a static LAN
address so the lab DNS can bind to it and the reader can find it. If the
router travels with the server and keeps its LAN, nothing changes.

---

## If the LAN does change

Three values describe the site, all in `.env`, which is not in version
control:

| Variable | What it is |
|---|---|
| `WIFI_IP` | This machine's LAN address. The lab DNS binds to it and answers the public hostname with it. |
| `ROUTER_IP` | The site router. The lab DNS asks it first, so a change of upstream resolver needs no edit here. |
| `PUBLIC_HOST` | The public hostname served through the tunnel. |

Then the static address itself in `/etc/netplan/*.yaml`, and:

```sh
sudo netplan apply
cd /opt/aiserver && docker compose up -d dns
sudo systemctl restart aiml-portal-mdns   # re-publishes the LAN name over mDNS
```

**The card reader has the old address compiled in.** `PORTAL_DNS_IP` in its
`secrets.h` is the resolver it asks. If `WIFI_IP` changes, the reader needs
that value changed and reflashing. Nothing else on the network has an address
baked in.

---

## After the move: the checklist

```sh
ip -4 -br addr show eno1                  # address and link
ping -c2 1.1.1.1                          # a route out
cd /opt/aiserver && docker compose ps     # all services back
docker logs --tail 20 aiserver_cloudflared | grep -i registered
dig +short portal.lan @"$WIFI_IP"         # the lab's own DNS
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1/
docker exec aiserver_postgres psql -U aiserver -d aiserver_db \
  -c "SELECT device_id, now() - last_seen_at AS ago FROM rfid_devices;"
```

Then open the public hostname **from a phone on mobile data** — not from the
lab network, which answers locally and proves nothing.

Every service is `restart: unless-stopped`, so the stack returns by itself
after a power cut with nobody logged in.

---

## If the public name works outside but not inside

The local network is answering for it. That is usually deliberate: the lab
DNS answers the public name with the server's LAN address so the portal keeps
working when the internet does not.

But a *second* resolver can do it by accident. A router with a static or
wildcard DNS entry for the domain hands every name in it to one internal
host, and the browser lands on whatever runs there — typically a 404 from
some other proxy, with a valid certificate, which makes it look like a server
fault. Compare the two answers:

```sh
dig +short <public-hostname> @<the resolver the client uses>
dig +short <public-hostname> @1.1.1.1
```

If they disagree, fix it on that resolver, not here.
