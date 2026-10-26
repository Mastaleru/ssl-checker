# SSL Checker notary

A small server that connects to a site **from wherever it runs** and reports the certificate chain it receives there. The extension compares that answer with the certificate the browser received: if they differ and the local certificate is not publicly logged, something on your path is re-signing the traffic.

One file (`server.mjs`), no dependencies, Node.js 20 or newer.

## Quick start

```bash
NOTARY_NAME="Frankfurt (Hetzner)" NOTARY_TOKEN="a-long-random-token" node server.mjs
curl -H "Authorization: Bearer a-long-random-token" "http://127.0.0.1:8080/v1/cert?host=example.com"
```

With Docker:

```bash
docker build -t ssl-checker-notary .
docker run -d --restart unless-stopped -p 127.0.0.1:8080:8080 \
  -e NOTARY_NAME="Frankfurt (Hetzner)" -e NOTARY_TOKEN="…" -e TRUST_PROXY=1 \
  ssl-checker-notary
```

The extension only accepts HTTPS addresses (except `localhost`), so put the notary behind a reverse proxy with a certificate. With Caddy the certificate is automatic:

```
notary.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

In the extension: **Options → External sources → Add a source**, with the address `https://notary.example.com/v1/cert` and the token.

**Choose the location carefully.** A notary is only useful if it reaches the site by a different path than your browser. A notary on a VPS in a data center sees the "clean" internet; one inside the same company network as you goes through the same proxy and sees the same interception. Two or three notaries in different countries and with different providers give the best coverage.

## Configuration

| Variable         | Default            | Purpose                                                                                                                              |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT` / `HOST`  | `8080` / `0.0.0.0` | Where the server listens.                                                                                                            |
| `NOTARY_NAME`    | host name          | Label shown in the extension.                                                                                                        |
| `NOTARY_TOKEN`   | —                  | When set, requests must send `Authorization: Bearer <token>`. Recommended for any public notary.                                     |
| `ALLOWED_PORTS`  | `443,8443`         | Ports the notary agrees to check.                                                                                                    |
| `CORS_ORIGIN`    | `*`                | Can be restricted to `chrome-extension://<extension id>`.                                                                            |
| `RATE_LIMIT`     | `30`               | Requests per minute per client IP. `0` disables the limit.                                                                           |
| `MAX_CONCURRENT` | `20`               | Simultaneous TLS handshakes; above the limit it answers `503 busy`.                                                                  |
| `CACHE_SECONDS`  | `60`               | How long an answer for the same `host:port` is reused.                                                                               |
| `TRUST_PROXY`    | —                  | `1` takes the client IP from `X-Forwarded-For`. Only behind your own reverse proxy.                                                  |
| `UPSTREAM_PROXY` | —                  | `http://host:port`: reach the sites through an HTTP CONNECT proxy. If that proxy inspects TLS, the notary sees the interception too. |
| `ALLOW_PRIVATE`  | —                  | `1` allows private addresses (for testing only: it opens the door to SSRF).                                                          |
| `LOG_HOSTS`      | —                  | `1` also writes the checked site to the log. Off by default, for privacy.                                                            |

## Security

- **SSRF:** the name is resolved first, and private, loopback, link-local, CGNAT, multicast and documentation addresses, plus their IPv6 equivalents (including IPv4-mapped, NAT64 and 6to4), are refused with `403 forbiddenTarget`. Without `UPSTREAM_PROXY`, the connection then goes to the IP address that was already checked, so DNS rebinding cannot change the target between the check and the connection.
- **Ports:** only those in `ALLOWED_PORTS`, so the notary cannot be used as a port scanner.
- **Abuse:** optional token, per-IP rate limit, concurrency limit, cache and an 8-second timeout per check.
- **Privacy:** the notary keeps nothing except the 60-second in-memory cache, and the log contains site names only with `LOG_HOSTS=1`.

## Protocol v1

Request:

```
GET /v1/cert?host=example.com&port=443
Authorization: Bearer <token>        (optional)
```

`200` response:

```json
{
  "version": 1,
  "host": "example.com",
  "port": 443,
  "observedAt": "2026-10-26T15:00:00.000Z",
  "vantage": "Frankfurt (Hetzner)",
  "address": "93.184.215.14",
  "trusted": true,
  "trustError": null,
  "tls": { "protocol": "TLSv1.3", "cipher": "TLS_AES_256_GCM_SHA384", "group": "X25519" },
  "chain": ["<base64 DER of the site certificate>", "<intermediate>", "…"]
}
```

`trusted` tells whether the chain is trusted by the Node.js certificate store on that server; `trustError` gives the reason when it is not (for example `CERT_HAS_EXPIRED`).

Errors use a `4xx` or `5xx` status and this body:

```json
{ "version": 1, "error": { "code": "forbiddenTarget", "message": "address is private or reserved" } }
```

Codes: `badRequest` (400), `unauthorized` (401), `forbiddenTarget`, `forbiddenPort` (403), `rateLimited` (429), `dnsFailed`, `connectFailed`, `tlsFailed` (502), `busy` (503), `timeout` (504).

`GET /v1/health` returns `{ "version": 1, "ok": true, "vantage": "…", "ports": [443, 8443], "auth": true }`.

Any server that follows this contract can be used as a source. The extension has no host permissions, so the server **must** send the CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Headers: Authorization`) and answer `OPTIONS` requests.
