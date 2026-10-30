# SSL Checker notary

A small Express service that connects to a site **from wherever it runs** and reports the certificate chain it receives there. The extension compares that answer with the certificate the browser received: if they differ and the local certificate is not publicly logged, something on the path is re-signing the traffic. The notary signs every answer with its own key, so that an interceptor between the browser and the notary cannot fake one.

The PlusPrivacy notary at `notary.plusprivacy.com` is the extension's default source. Anyone can run another one and add it in the extension's Options, with its key.

## Run it locally

Node.js 22 or newer:

```bash
npm ci
npm run keygen -- secrets/signing-key.pem       # once: creates the key and prints its public half
NOTARY_NAME="My laptop" SIGNING_KEY_FILE=secrets/signing-key.pem npm start
curl "http://127.0.0.1:8080/v1/cert?host=example.com"
```

Without `SIGNING_KEY_FILE` the notary works too, but its answers are not signed. `npm test` runs the tests; none of them needs the internet.

## Deploy on a VPS

The smallest plan of most providers is enough: 1 vCPU, 1 GB of RAM, Ubuntu 24.04 or 26.04 LTS. Pick a provider and a country different from your own network: the notary only helps if it reaches sites by another path than your browser.

1. **DNS.** Point `notary.plusprivacy.com` at the server: an A record, plus AAAA if it has IPv6.

2. **Two users.** Logged in as root, bring the system up to date, then create them:

   ```bash
   apt update && apt full-upgrade -y
   [ -f /var/run/reboot-required ] && reboot   # then log in again as root

   getent passwd 1000; getent group 1000       # must print nothing
   groupadd --gid 1000 notary
   useradd --uid 1000 --gid notary --no-create-home --home-dir /nonexistent \
     --shell /usr/sbin/nologin --comment "SSL Checker notary" notary
   adduser rafael && usermod -aG sudo rafael
   ```

   The notary runs as uid 1000 inside its container, so on the server that uid gets a name of its own: `notary` cannot log in and owns only the signing key. Create it before your own user, or `adduser` gives uid 1000 to you: you would own the key, and a process that ever escaped the container would be you, with sudo and your `~/.ssh`. If `getent` prints a user, such as the `ubuntu` user of cloud images, and you do not use it, remove it first with `deluser --remove-home ubuntu`. Your user (uid 1001) logs in with your key and uses `sudo`.

   Then your SSH key. If root already has it (`/root/.ssh/authorized_keys`, which the provider's panel can fill in), check that the file holds only your keys and copy it:

   ```bash
   install -d -m 700 -o rafael -g rafael /home/rafael/.ssh
   install -m 600 -o rafael -g rafael /root/.ssh/authorized_keys /home/rafael/.ssh/
   ```

   Otherwise send it from your computer: `ssh-copy-id rafael@notary.plusprivacy.com` on Linux and macOS, or from PowerShell on Windows (run `ssh-keygen -t ed25519` first if you have no key):

   ```powershell
   Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | ssh rafael@notary.plusprivacy.com "umask 077; mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
   ```

   Until DNS answers, use the server's IP address instead of its name. On the first connection, compare the fingerprint that ssh shows with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server. Then, from a second window, `ssh rafael@notary.plusprivacy.com` must log in without asking for your account's password, and `sudo -v` must accept it. Keep the root session open until step 5 is done.

3. **Firewall.** Pick the port that SSH moves to in step 4: between 1024 and 32767 (higher ones are Linux's ephemeral ports), and not 2222, which scanners try almost as often as 22. A port of its own does not make SSH safer, but it keeps most scans out of the logs. With port 22 still open:

   ```bash
   SSH_PORT=27183   # an example: pick your own
   ufw default deny incoming && ufw default allow outgoing
   ufw allow OpenSSH && ufw allow "$SSH_PORT"/tcp
   ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
   ufw enable       # answer y: the open session stays
   ```

   Ports published by Docker bypass ufw. That is why only Caddy publishes ports (80 and 443) and the notary publishes none.

4. **SSH on that port, with keys only and without root.** In the same root session:

   ```bash
   cat > /etc/ssh/sshd_config.d/00-hardening.conf <<EOF
   Port $SSH_PORT
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin no
   AllowUsers rafael
   EOF
   sshd -t && sshd -T | grep -E '^(port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|allowusers) '
   ```

   The last command must show your port, `allowusers rafael`, and `no` for the other three. The `00-` prefix matters: sshd keeps the first value it reads, and it reads `sshd_config.d` in alphabetical order before the main file, so no later file can turn passwords back on (some providers add a `50-cloud-init.conf` that does). If `port 22` shows up too, comment out the `Port 22` line in `/etc/ssh/sshd_config`.

   Ubuntu 24.04 starts SSH from `ssh.socket`: systemd listens on the port, so a new port needs the socket restarted, not only `reload ssh`. The open session stays:

   ```bash
   systemctl daemon-reload
   systemctl is-active --quiet ssh.socket && systemctl restart ssh.socket
   systemctl restart ssh
   ss -tlnp | grep -E ":(22|$SSH_PORT) "     # your port only
   ```

   On your computer, add the server to `~/.ssh/config` (`%USERPROFILE%\.ssh\config` on Windows, a file without an extension), with the port from step 3:

   ```
   Host notary
       HostName notary.plusprivacy.com
       User rafael
       Port 27183
   ```

   From new windows, `ssh notary` must log in, while `ssh root@notary` and `ssh -o PubkeyAuthentication=no notary` must end in `Permission denied (publickey)`. Only then close port 22 on the server: `ufw delete allow OpenSSH`. If you ever lock yourself out, the provider's web console still logs in with a password, since it does not go through SSH.

5. **fail2ban for SSH.** Even with keys only, it stops scans from filling the logs. It bans on the port it is given:

   ```bash
   apt install -y fail2ban
   printf '[sshd]\nenabled = true\nport = %s\nmaxretry = 5\nbantime = 1h\n' "$SSH_PORT" > /etc/fail2ban/jail.d/sshd.local
   systemctl restart fail2ban && fail2ban-client status sshd
   ```

   Now close the root session: from here on, log in with `ssh notary` and use `sudo`. Reboot once (`sudo reboot`) and check that `ssh notary` still logs in, since step 6 lets the server reboot by itself.

6. **Automatic security updates.** `sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`. In `/etc/apt/apt.conf.d/50unattended-upgrades`, set `Unattended-Upgrade::Automatic-Reboot "true";` and `Unattended-Upgrade::Automatic-Reboot-Time "04:00";`.

7. **Docker.** Install Docker Engine and the compose plugin from Docker's apt repository, as described in [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Skip the post-installation step that adds your user to the `docker` group: that group amounts to root without a password, so the commands below run `docker` through `sudo`, which asks for yours.

8. **The notary and its signing key.**

   ```bash
   git clone -b v2 https://github.com/Mastaleru/ssl-checker.git
   cd ssl-checker/notary
   cp .env.example .env        # check NOTARY_DOMAIN, NOTARY_NAME and ALLOWED_ORIGINS
   mkdir -m 700 secrets
   openssl genpkey -algorithm ed25519 -out secrets/signing-key.pem
   sudo chown notary:notary secrets/signing-key.pem && sudo chmod 400 secrets/signing-key.pem
   sudo docker compose up -d --build
   sudo docker compose logs -f # Caddy reports the certificate it obtained
   ```

   The key never leaves the server and is not in git (`notary/secrets/` is ignored). The notary runs as uid 1000 inside its container, the `notary` user of step 2, so the file must belong to that user; the `secrets` folder keeps everyone else out. Compose mounts the file read-only, and the notary refuses to start if it is missing or unreadable.

   **Or build the image on your own computer** and upload it, so that the server builds nothing. With Docker Desktop running, from the project folder:

   ```bash
   npm run notary:image                                # for an ARM server: npm run notary:image -- --platform linux/arm64
   scp dist/ssl-checker-notary-1.0.0-linux-amd64.tar.gz dist/ssl-checker-notary-1.0.0-linux-amd64.tar.gz.sha256 notary:
   ```

   Then, on the server, instead of `sudo docker compose up -d --build`:

   ```bash
   sha256sum -c ssl-checker-notary-1.0.0-linux-amd64.tar.gz.sha256 && sudo docker load -i ssl-checker-notary-1.0.0-linux-amd64.tar.gz
   cd ssl-checker/notary && sudo docker compose up -d
   ```

   The script tags the image `ssl-checker-notary:local`, the name `compose.yaml` runs, and `docker compose up -d` without `--build` uses the loaded image. It labels the image with the commit it was built from (`sudo docker inspect ssl-checker-notary:local`), and prints these commands with the exact file names. The server still needs the repository for `compose.yaml`, the `Caddyfile` and `.env`, and it pulls Caddy's image itself. The signing key is never in the image: `.dockerignore` leaves `secrets/` out.

9. **The key for the extension.** Print the notary's public key on the server:

   ```bash
   sudo docker compose exec notary node src/keygen.js /run/secrets/signing_key
   ```

   Put the `ed25519:…` line it prints into `extension/lib/default-notary.js` (`keys`), commit it, and build the extension from that commit. Until its key is there, the extension does not ask the notary at all. The startup line in `docker compose logs notary` and `/v1/health` show the same key, but read it on the server: a key copied over a network you do not trust is exactly what signing is meant to protect against.

10. **Check it** from your own computer:

    ```bash
    curl https://notary.plusprivacy.com/v1/health
    curl -H "Origin: chrome-extension://nbanpljakngdndmmekhogfliinegiapb" \
      "https://notary.plusprivacy.com/v1/cert?host=example.com"
    ```

    Then use the **Test** button next to PlusPrivacy in the extension's Options: it reports whether the answer is signed with the expected key.

11. **Keep it running.**
    - **Updates:** `git pull && sudo docker compose up -d --build`. With an image built on your computer: `git pull`, upload and `sudo docker load` the new image, then `sudo docker compose up -d`.
    - **Base images:** once a month, run `sudo docker compose build --pull && sudo docker compose up -d` to pick up their security fixes.
    - **Backups:** back up `.env`, and `secrets/signing-key.pem` somewhere safe and offline, such as a password manager (`sudo cat secrets/signing-key.pem`). If the key is lost, every installed extension rejects the answers of a new one until it is updated. Caddy's certificates live in the `caddy-data` volume and are renewed automatically.
    - **Monitoring:** an external uptime check on `/v1/health` tells you when the notary goes down.

### Changing the signing key

The extension accepts any key listed in `DEFAULT_NOTARY.keys`, so a key can be replaced without breaking anyone:

1. Create the new key next to the old one and print its public key:

   ```bash
   openssl genpkey -algorithm ed25519 -out secrets/signing-key-new.pem
   sudo chown notary:notary secrets/signing-key-new.pem && sudo chmod 400 secrets/signing-key-new.pem
   sudo docker compose run --rm --no-deps -v "$PWD/secrets/signing-key-new.pem:/new.pem:ro" notary node src/keygen.js /new.pem
   ```

   Add that key to `keys`, next to the old one.

2. Publish that version of the extension and wait until most users have it (the dashboard shows the versions in use).
3. Replace `secrets/signing-key.pem` with the new file (`sudo mv secrets/signing-key-new.pem secrets/signing-key.pem`) and run `sudo docker compose up -d --force-recreate notary`: the notary reads its key only when it starts, and a plain `up -d` sees no change to recreate.
4. In the next version of the extension, remove the old key.

If the key may have leaked, skip the wait: switch the notary to a new key the same way and publish an extension with only the new key at once. Until users update, they see "signed with a key this extension does not know" instead of a confirmation, which is the safe failure.

## Configuration

Environment variables, set in `.env` (see `.env.example`). A bad value stops the notary at startup with a message that names it.

| Variable                 | Default            | Purpose                                                                                                                                                 |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTARY_DOMAIN`          | —                  | Public name; Caddy gets its Let's Encrypt certificate. Used by `compose.yaml` only.                                                                     |
| `NOTARY_NAME`            | host name          | Label shown in the extension.                                                                                                                           |
| `ALLOWED_ORIGINS`        | any                | Comma-separated origins that browsers may use the notary from, e.g. `chrome-extension://<extension id>`. `CORS_ORIGIN` is the old name.                 |
| `REQUIRE_ORIGIN`         | `0`                | `1` refuses requests that carry no `Origin`. Health checks are not affected.                                                                            |
| `RATE_LIMIT`             | `30`               | Checks per minute per client address (IPv6: per /64). `0` disables the limit.                                                                           |
| `BAN_STRIKES`            | `5`                | Refused requests (over the limit, wrong token, foreign origin) that get a client banned.                                                                |
| `BAN_WINDOW_MINUTES`     | `10`               | Window in which those strikes are counted.                                                                                                              |
| `BAN_FIRST_MINUTES`      | `1`                | Length of the first ban; each next one doubles.                                                                                                         |
| `BAN_MAX_HOURS`          | `24`               | Longest ban, and how long a quiet client is remembered.                                                                                                 |
| `ABUSE_ALERT_PER_MINUTE` | `300`              | Strikes from all clients in one minute that trigger a warning in the log.                                                                               |
| `GLOBAL_RATE_LIMIT`      | `600`              | Checks per minute for all clients together; above it, `503 busy`. Answers from the cache do not count. `0` disables it.                                 |
| `MAX_CONCURRENT`         | `20`               | Simultaneous TLS handshakes; above it, `503 busy`.                                                                                                      |
| `CACHE_SECONDS`          | `60`               | How long an answer for the same `host:port` is reused.                                                                                                  |
| `TIMEOUT_SECONDS`        | `8`                | Time allowed for one check.                                                                                                                             |
| `ALLOWED_PORTS`          | `443,8443`         | Ports the notary agrees to check.                                                                                                                       |
| `NOTARY_TOKEN`           | —                  | Makes the notary private: requests must send `Authorization: Bearer <token>`. At least 32 characters (`openssl rand -base64 32`).                       |
| `SIGNING_KEY_FILE`       | —                  | Ed25519 private key (PEM) that signs every answer. `compose.yaml` sets it to the mounted `secrets/signing-key.pem`. Without it, answers are not signed. |
| `TRUST_PROXY`            | —                  | Proxies in front of the notary, for the client address: a hop count (`1`) or addresses. `compose.yaml` sets `1` for Caddy.                              |
| `PORT` / `HOST`          | `8080` / `0.0.0.0` | Where the notary listens. `compose.yaml` sets them.                                                                                                     |
| `UPSTREAM_PROXY`         | —                  | `http://host:port`: reach sites through an HTTP CONNECT proxy. If that proxy inspects TLS, the notary sees the interception too.                        |
| `ALLOW_PRIVATE`          | `0`                | `1` allows private addresses, for testing only: it opens the door to SSRF.                                                                              |
| `LOG_HOSTS`              | `0`                | `1` writes the checked site to the log. Off by default, for privacy.                                                                                    |

## Protection

A public notary cannot tell the extension from a script that imitates it: the extension's code is public, and a script can send any header. So it accepts everyone the extension would, and limits what anyone can take.

- **Origin.** Chrome sends `Origin: chrome-extension://<id>` with every request of the extension, and web pages cannot change it. With `ALLOWED_ORIGINS`, no other website can use its visitors' browsers to query the notary. `REQUIRE_ORIGIN=1` also turns away scripts that send no `Origin`.
- **Rate limit and bans.** Each client address gets `RATE_LIMIT` checks a minute. A request refused for abuse is a strike: over the limit, a wrong token, or a foreign origin. `BAN_STRIKES` strikes within `BAN_WINDOW_MINUTES` ban the client for `BAN_FIRST_MINUTES`, and every later ban lasts twice as long, up to `BAN_MAX_HOURS`. A banned client gets `429` with `Retry-After`. This is also what stops a token from being guessed.
- **Capacity.** At most `MAX_CONCURRENT` handshakes at once and `GLOBAL_RATE_LIMIT` per minute. Answers are cached for `CACHE_SECONDS`, so a site is contacted at most once a minute however many people check it.
- **SSRF.** The name is resolved first, and private, loopback, link-local, CGNAT, multicast and documentation addresses are refused with `403 forbiddenTarget`. Their IPv6 equivalents are refused too, including IPv4-mapped, NAT64 and 6to4. The connection then goes to the address that was checked, so DNS rebinding cannot change the target in between. Only `ALLOWED_PORTS` can be checked, so the notary cannot be used as a port scanner.
- **Client address.** Express reads `X-Forwarded-For` only as far as `TRUST_PROXY` allows. Behind Caddy, it uses the address Caddy saw, which a client cannot forge.
- **Container.** The container runs as a non-root user, on a read-only filesystem, with no Linux capabilities and no privilege escalation. CPU, memory and process limits apply.

**What the notary keeps.** Nothing is written to disk; the signing key is only read, from a read-only file. In memory it keeps three things:

- the answers, for `CACHE_SECONDS`;
- a request counter per client address, for one minute;
- the strikes and bans of abusive clients, until they have been quiet for `BAN_MAX_HOURS`.

Its log lists requests without client addresses or sites. Only bans name the client address. Caddy writes no access log.

## Protocol v1

Request:

```
GET /v1/cert?host=example.com&port=443&nonce=Xq3MpTb0vR9kLs2eWn5yZA
Authorization: Bearer <token>        (only for a private notary)
```

`port` defaults to 443. `nonce` is optional: 16 to 128 characters from `A-Z a-z 0-9 - _`, new for every request; the extension sends 16 random bytes in base64url.

`200` response:

```
Notary-Signature: <Ed25519 signature, base64url>
Content-Type: application/json; charset=utf-8

{
  "version": 1,
  "host": "example.com",
  "port": 443,
  "observedAt": "2026-10-29T15:00:00.000Z",
  "vantage": "PlusPrivacy",
  "address": "93.184.215.14",
  "trusted": true,
  "trustError": null,
  "tls": { "protocol": "TLSv1.3", "cipher": "TLS_AES_256_GCM_SHA384", "group": "X25519" },
  "chain": ["<base64 DER of the site certificate>", "<intermediate>", "…"],
  "nonce": "Xq3MpTb0vR9kLs2eWn5yZA",
  "key": "ed25519:<public key, base64url>"
}
```

`trusted` tells whether the chain is trusted by the Node.js certificate store on that server; `trustError` gives the reason when it is not (for example `CERT_HAS_EXPIRED`). A cached answer keeps its original `observedAt`. `nonce` repeats the request's nonce (`null` without one), and `key` is the notary's public key (`null`, and no `Notary-Signature` header, when it has no signing key).

Errors use a `4xx` or `5xx` status and this body:

```json
{ "version": 1, "error": { "code": "forbiddenTarget", "message": "address is private or reserved" } }
```

| Code                                      | Status        | Meaning                                                                       |
| ----------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `badRequest`                              | 400, 404, 405 | Malformed host, port or nonce, unknown path, or a method other than GET.      |
| `unauthorized`                            | 401           | Missing or wrong token (private notaries only).                               |
| `forbiddenOrigin`                         | 403           | The request came from an origin that is not allowed, or without one.          |
| `forbiddenTarget`                         | 403           | The site resolves only to private or reserved addresses.                      |
| `forbiddenPort`                           | 403           | The port is not in `ALLOWED_PORTS`.                                           |
| `rateLimited`                             | 429           | Over the rate limit, or banned; `Retry-After` says for how long.              |
| `dnsFailed`, `connectFailed`, `tlsFailed` | 502           | The site could not be resolved, reached, or did not complete the handshake.   |
| `busy`                                    | 503           | Too many checks at once or this minute; `Retry-After` says when to try again. |
| `timeout`                                 | 504           | The check took longer than `TIMEOUT_SECONDS`.                                 |

`GET /v1/health` returns `{ "version": 1, "ok": true, "vantage": "…", "ports": [443, 8443], "auth": false, "key": "ed25519:…" }`.

Any server that follows this contract can be a source. The extension has no host permissions, so the server **must** send the CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Headers: Authorization`, and `Access-Control-Expose-Headers: Notary-Signature` when it signs) and answer `OPTIONS` requests.

### Signed answers

The signature in `Notary-Signature` is Ed25519 over these bytes: the line `SSL Checker notary answer v1` followed by a line feed (`0x0a`), then the body exactly as sent. A client that knows the notary's public key accepts an answer only when:

1. the signature holds for that key over those bytes;
2. `nonce` is the one it just sent, so an old answer cannot be replayed;
3. `host` and `port` are the ones it asked for, so an interceptor cannot send the notary to look at a server of its choosing. The notary writes the host the way a URL parser does: lower case, names in ASCII (punycode), no IPv6 brackets or final dot. It refuses a host that carries a port, a user name or a path, with `400`.

Then nobody between the client and the notary can change an answer unnoticed, not even an interceptor whose root certificate the browser trusts. The key is written `ed25519:` followed by the 32-byte public key in base64url without padding (43 characters). Only `200` answers are signed; errors are not, so whoever controls the network can still block or fail a request, as always. The extension's check is in `extension/lib/notary-signature.js`; against a notary running locally, the same check in Node.js looks like this:

```js
import { createPublicKey, randomBytes, verify } from 'node:crypto';

const key = 'ed25519:…'; // the notary's public key, as it prints it
const nonce = randomBytes(16).toString('base64url'); // a new one for every request
const res = await fetch(`http://127.0.0.1:8080/v1/cert?host=example.com&port=443&nonce=${nonce}`);
const body = Buffer.from(await res.arrayBuffer()); // the raw bytes, before any JSON parsing
const publicKey = createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: key.slice(8) } });
const message = Buffer.concat([Buffer.from('SSL Checker notary answer v1\n'), body]);
const answer = JSON.parse(body);
const genuine =
  verify(null, message, publicKey, Buffer.from(res.headers.get('notary-signature'), 'base64url')) &&
  answer.nonce === nonce &&
  answer.host === 'example.com' &&
  answer.port === 443;
```

## Code

```
src/
  main.js                 reads the configuration, listens, stops cleanly on SIGTERM
  app.js                  the Express app: middleware in the order a request meets it
  config.js               environment variables, checked at startup
  errors.js  log.js       protocol errors; JSON log lines
  signing.js              the signing key and the signature of each answer
  keygen.js               creates a signing key, or prints the public half of one
  middleware/
    origin.js             CORS headers and the Origin check
    bans.js               strikes and escalating bans
    limits.js             per-client rate limit (express-rate-limit)
    auth.js               optional bearer token
    common.js             headers, methods, 404 and the error handler
  routes/
    cert.js  health.js    the two endpoints
  probe/
    target.js             host checks, SSRF ranges, DNS
    tls.js                the TLS handshake and the chain
    upstream.js           HTTP CONNECT through UPSTREAM_PROXY
    service.js            cache, one probe per site at a time, capacity caps
  healthcheck.js          Docker's health check
test/                     node:test, run with npm test
```

To add an endpoint, write its handler in `src/routes/`, mount it in `src/app.js` behind the checks it needs (copy the `/v1/cert` block for the full chain), and add a test in `test/`. A check that every route needs goes in `src/middleware/`.
