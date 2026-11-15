# Certificates: what serves what, and what expires

There are **two** certificates in this deployment and they are renewed in
completely different ways. Confusing them is easy, because both are valid
for the same hostname from a browser's point of view.

---

## 1. The edge certificate — public visitors

Cloudflare terminates TLS for the public hostname at its own edge, with its
own certificate, and **renews it automatically**. Nothing on this server is
involved and nothing expires here.

## 2. The origin certificate — the LAN and the card reader

`nginx/certs/server.crt` is what nginx itself presents. Three parties see it:

| Who | Verifies it? | What an expiry does |
|---|---|---|
| Cloudflare Tunnel | **No** — the connector is configured `noTLSVerify` | nothing; the public site keeps working |
| Browsers on the LAN, using the `.local` name | Yes, if the CA is trusted | certificate warnings |
| **The RFID reader** | **Yes, strictly** — it pins the CA in `portal_ca.h` | **the reader stops working entirely** |

That last row is the one that matters. The reader validates both the chain
and the hostname, so it stops clocking people in the day the origin
certificate expires.

### There is no automatic renewal

No certbot, no cron entry, no systemd timer. Renewal is manual, and these
are the facts to plan around:

- The origin certificate is issued by a **private CA** (mkcert), not a public
  one, so ACME/Let's Encrypt does not apply as things stand.
- **The CA private key is not on this server.** It lives on the workstation
  where the CA was created. Without it a replacement certificate cannot be
  issued at all.
- The CA certificate itself is long-lived; the leaf is not.

**Before the leaf expires**, on the machine holding the CA:

```sh
mkcert -cert-file server.crt -key-file server.key \
    portal.lan localhost 127.0.0.1
```

Copy `server.crt` and `server.key` into `nginx/certs/`, then
`docker exec aiserver_nginx nginx -s reload`. If the **CA** is ever replaced,
the reader's `portal_ca.h` must be updated and the reader reflashed, or it
will refuse to connect.

### Check what is actually being served

```sh
echo | openssl s_client -connect 127.0.0.1:443 -servername portal.lan 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

### Worth considering

Because the reader is the only strict verifier, the fragile part is a private
CA with an off-box key and no renewal. Two ways out, both larger changes than
this page: issue the origin certificate from a public CA via DNS-01 (the
public hostname is already on Cloudflare, which has an ACME DNS API), or
accept the manual renewal and **put a calendar reminder two months before the
leaf expires**. Doing neither means the reader stops on a date nobody has
written down.
