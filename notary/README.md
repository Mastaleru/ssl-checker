# Notarul SSL Checker

Un server mic care se conectează la un site **din locul în care rulează** și raportează lanțul de certificate pe care îl primește acolo. Extensia compară răspunsul cu certificatul primit de browser: dacă diferă, iar certificatul local nu e înregistrat public, cineva de pe drumul tău re-semnează traficul.

Un singur fișier (`server.mjs`), fără dependențe, Node.js 20 sau mai nou.

## Pornire rapidă

```bash
NOTARY_NAME="Frankfurt (Hetzner)" NOTARY_TOKEN="un-token-lung-și-aleator" node server.mjs
curl -H "Authorization: Bearer un-token-lung-și-aleator" "http://127.0.0.1:8080/v1/cert?host=example.com"
```

Cu Docker:

```bash
docker build -t ssl-checker-notary .
docker run -d --restart unless-stopped -p 127.0.0.1:8080:8080 \
  -e NOTARY_NAME="Frankfurt (Hetzner)" -e NOTARY_TOKEN="…" -e TRUST_PROXY=1 \
  ssl-checker-notary
```

Extensia acceptă doar adrese HTTPS (în afară de `localhost`), deci pune notarul în spatele unui reverse proxy cu certificat. Cu Caddy, certificatul vine automat:

```
notar.exemplu.ro {
    reverse_proxy 127.0.0.1:8080
}
```

În extensie: **Opțiuni → Surse externe → Adaugă o sursă**, cu adresa `https://notar.exemplu.ro/v1/cert` și tokenul.

**Alege locul cu grijă.** Un notar e util doar dacă ajunge la site pe alt drum decât browserul tău. Un notar pe un VPS dintr-un datacenter vede internetul „curat”; unul în aceeași rețea de firmă cu tine trece prin același proxy și va vedea aceeași interceptare. Două-trei notare în țări și la furnizori diferiți dau cea mai bună acoperire.

## Configurare

| Variabilă | Implicit | Rol |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Unde ascultă serverul. |
| `NOTARY_NAME` | numele mașinii | Eticheta afișată în extensie. |
| `NOTARY_TOKEN` | — | Dacă e setat, cererile trebuie să trimită `Authorization: Bearer <token>`. Recomandat pentru orice notar public. |
| `ALLOWED_PORTS` | `443,8443` | Porturile pe care notarul acceptă să le verifice. |
| `CORS_ORIGIN` | `*` | Poți restrânge la `chrome-extension://<id-ul extensiei>`. |
| `RATE_LIMIT` | `30` | Cereri pe minut per IP client. `0` dezactivează limita. |
| `MAX_CONCURRENT` | `20` | Handshake-uri TLS simultane; peste limită răspunde `503 busy`. |
| `CACHE_SECONDS` | `60` | Cât reutilizează un răspuns pentru același `host:port`. |
| `TRUST_PROXY` | — | `1` = IP-ul clientului vine din `X-Forwarded-For`. Doar în spatele propriului reverse proxy. |
| `UPSTREAM_PROXY` | — | `http://gazdă:port` — iese spre site-uri printr-un proxy HTTP CONNECT. Dacă acel proxy inspectează TLS, notarul va vedea și el interceptarea. |
| `ALLOW_PRIVATE` | — | `1` permite adrese private (doar pentru teste: deschide SSRF). |
| `LOG_HOSTS` | — | `1` scrie în jurnal și site-ul verificat. Implicit nu, pentru confidențialitate. |

## Securitate

- **SSRF:** numele e rezolvat întâi, iar adresele private, de loopback, link-local, CGNAT, multicast, de documentare și IPv6 echivalentele lor (inclusiv IPv4-mapped, NAT64 și 6to4) sunt refuzate cu `403 forbiddenTarget`. Conexiunea se face apoi la IP-ul deja verificat, deci un DNS rebinding nu poate schimba ținta între verificare și conectare.
- **Porturi:** doar cele din `ALLOWED_PORTS`, ca notarul să nu devină scanner de porturi.
- **Abuz:** token opțional, rate limit pe IP, limită de concurență, cache și timeout de 8 secunde per verificare.
- **Confidențialitate:** notarul nu păstrează nimic în afară de cache-ul de 60 de secunde din memorie, iar jurnalul nu conține site-urile decât cu `LOG_HOSTS=1`.

## Protocolul v1

Cerere:

```
GET /v1/cert?host=example.com&port=443
Authorization: Bearer <token>        (opțional)
```

Răspuns `200`:

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
  "chain": ["<DER în base64, certificatul site-ului>", "<intermediar>", "…"]
}
```

`trusted` spune dacă lanțul e de încredere pentru magazinul de certificate al Node.js de pe acel server; `trustError` dă motivul (de exemplu `CERT_HAS_EXPIRED`).

Erori: status `4xx`/`5xx` și

```json
{ "version": 1, "error": { "code": "forbiddenTarget", "message": "address is private or reserved" } }
```

Coduri: `badRequest` (400), `unauthorized` (401), `forbiddenTarget`, `forbiddenPort` (403), `rateLimited` (429), `dnsFailed`, `connectFailed`, `tlsFailed` (502), `busy` (503), `timeout` (504).

`GET /v1/health` întoarce `{ "version": 1, "ok": true, "vantage": "…", "ports": [443, 8443], "auth": true }`.

Orice server care respectă acest contract poate fi folosit ca sursă; extensia nu are permisiuni pe site-uri, deci serverul **trebuie** să trimită headerele CORS (`Access-Control-Allow-Origin`, `Access-Control-Allow-Headers: Authorization`) și să răspundă la `OPTIONS`.
