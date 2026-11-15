# Certificates

There are two, renewed in completely different ways, and both are automatic.
Nothing here needs a diary entry.

---

## 1. The edge certificate — public visitors

Cloudflare terminates TLS for the public hostname at its own edge with its own
certificate and renews it itself. Nothing on this server is involved.

## 2. The origin certificate — the LAN and the card reader

`nginx/certs/le-ai.crt` is what nginx presents. It is a **Let's Encrypt**
certificate for the public hostname, issued over a **DNS-01** challenge and
renewed by `certbot` every 60 days.

DNS-01 matters here: the usual HTTP-01 challenge needs Let's Encrypt to reach
this server from the internet on port 80, which is impossible behind CGNAT.
DNS-01 proves control of the domain by writing a temporary TXT record
instead, so it needs no inbound connection at all and keeps working from any
network, behind any ISP.

Three parties see this certificate:

| Who | Verifies it? | If it expired |
|---|---|---|
| Cloudflare Tunnel | No — the connector runs `noTLSVerify` | nothing; the public site keeps working |
| Browsers on the LAN | Yes | certificate warnings |
| **The RFID reader** | **Yes, strictly** — it pins the root | **it stops clocking people in** |

### Why the reader does not care about renewals

The reader pins **ISRG Root X1**, the Let's Encrypt root, which is valid until
2035. The leaf rotates every 60 days underneath it; the root does not move, so
a renewal is invisible to the reader and it never needs reflashing for one.

The chain served is:

```
<public hostname>  <-  YE2  <-  Root YE  <-  ISRG Root X2  <-  ISRG Root X1
```

### How the renewal reaches nginx

certbot writes to `/etc/letsencrypt/live/`, which the nginx container cannot
see — it is given only `./nginx/certs`. A deploy hook copies each renewal
across and reloads nginx:

```
/etc/letsencrypt/renewal-hooks/deploy/10-aiserver-nginx.sh
```

Without that hook the certificate would renew every sixty days and nginx would
go on serving the expired one, which is the classic way an "automatic" setup
fails silently.

### Checking it

```sh
systemctl list-timers certbot.timer        # when it next runs
sudo certbot renew --dry-run               # the whole path, without issuing
echo | openssl s_client -connect 127.0.0.1:443 -servername <public-hostname> \
  2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

### Setting this up elsewhere

1. A Cloudflare API token with **Zone:DNS:Edit** on the zone, in
   `/etc/letsencrypt/cloudflare.ini`, mode 600:
   ```
   dns_cloudflare_api_token = <token>
   ```
2. Issue it:
   ```sh
   certbot certonly --non-interactive --agree-tos \
     --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
     --dns-cloudflare-propagation-seconds 30 \
     -d <public-hostname>
   ```
3. Install the deploy hook, and run it once by hand so nginx picks up the
   first certificate.

The token is used for a few seconds every sixty days and can do nothing but
edit DNS records in that one zone.

---

## What this replaced, and why

The origin certificate used to come from a **private mkcert CA**. That worked,
but it had three problems that only ever got worse:

- **nothing renewed it** — no certbot, no cron, no timer;
- **the CA private key was not on this server**, so the certificate could not
  be reissued here at all;
- **the reader pinned that private CA**, so the day the leaf expired the
  reader would have stopped recording attendance, with no warning and no way
  to fix it without the other machine.

It also forced the reader to use a `.local` name, because no public CA will
ever sign one — and that name had to be answered over multicast DNS, which
needed a separate responder running beside the portal.

Moving to Let's Encrypt removed all of it: the renewal, the off-box key, the
expiry, and the mDNS responder. The reader now uses the public hostname, which
the lab's own DNS answers with the portal's LAN address, so traffic still
never leaves the building.
