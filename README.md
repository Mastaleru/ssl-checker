# SSL Checker 1.0

A Chrome extension (Manifest V3) that shows the TLS certificate of the site in the current tab — the one your browser **actually received** — and compares it with what independent "notary" servers see, to detect HTTPS interception (a company proxy, an antivirus or something else).

## What changed since 0.3

| 0.3 (2017) | 1.0 |
|---|---|
| Manifest V2, disabled by Chrome 138 and removed from the Chrome Web Store on 31 August 2026 | Manifest V3, service worker, ES modules |
| Scraped the HTML of sslchecker.com | Reads the certificate straight from Chrome, plus configurable notaries with a documented JSON protocol |
| jQuery 3.2.1 and Bootstrap (with known vulnerabilities), `innerHTML` with external data | No dependencies; the DOM is built only with `textContent` |
| Host permission for sslchecker.com | `activeTab`, `storage`, `debugger` (no `debugger` in the lite package); no host permissions |
| English only | English and Romanian |

## Layout

```
extension/              what Chrome loads (Load unpacked) and what gets packaged
  manifest.json
  background/           service worker: local reading (chrome.debugger), notary queries
  lib/                  X.509 parser, verdict, host names, known interceptors, settings, i18n
  popup/  options/  ui/ user interface
  _locales/{en,ro}/     messages
  fonts/  icons/
notary/                 reference notary server (one Node.js file), Dockerfile and README
scripts/build.mjs       builds dist/ssl-checker-<version>.zip and the lite package
build/package.cmd       Windows shortcut for scripts/build.mjs
store/                  Chrome Web Store texts, screenshots, privacy policy and publishing guide
tests/                  unit, integration (notary) and end-to-end (Chromium) tests
```

## Load it locally

`chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select the `extension/` folder. Open an HTTPS site and click the toolbar icon.

## How it works

**Local reading.** Chrome has no extension API for the certificate of a loaded page, so the extension attaches `chrome.debugger` to the tab for about a second: `Network.enable`, a cookie-less `HEAD /favicon.ico` request sent from an isolated world (the page cannot intercept it), then `Network.getCertificate`. The page's service worker is bypassed, so the response comes from the network. Pages with a strict Content Security Policy block that request; for them the popup offers "Reload page and read". The mode is chosen in Options: *every time*, *on demand* or *never*. Chrome does not allow `debugger` as an optional permission, which is why there is also a lite package without it.

**Notaries.** Each endpoint receives `?host=&port=` (or a URL template with `{host}` and `{port}`) and returns the certificate chain it sees from where it runs. The protocol and the reference server are described in [`notary/README.md`](notary/README.md).

**The verdict** compares the SHA-256 fingerprint and the public key (SPKI) of the local certificate with the notaries' ones, then the issuer. Certificate Transparency tells whether the local certificate is public: Chrome reports "compliant" only for publicly logged certificates, and "unknown" for locally installed roots, which is exactly where interceptors live.

| Situation | Verdict |
|---|---|
| Same certificate (or same key) as the notaries | Confirmed |
| Different certificate, same issuer | Same issuer (normal behind CDNs) |
| Different from every notary, not confirmed as public | **Connection likely intercepted** (names the issuer and, when known, the product) |
| Different from every notary, but public | Sources see different certificates |
| Same as some notaries, different from others, not confirmed as public | Sources disagree (explains both possibilities) |
| Same as some notaries, different from others, public | Confirmed, with a note about the sources that differ |
| No notaries: public / not confirmed as public | Publicly logged certificate / Not confirmed as a public certificate |
| Notaries only (local reading off or failed) | Seen by external sources |
| Plain HTTP page | Unencrypted page (plus the certificate on port 443, if any) |

Additional warnings: expired or expiring soon, name not covered, SHA-1 or MD5 in the chain, RSA keys under 2048 bits, TLS 1.0/1.1, a notary that does not trust what it sees.

## Tests

```bash
npm test                    # X.509 parser (checked against pyca/cryptography), verdict, translations, notary
npm install && npx playwright install chromium
npm run test:e2e            # 13 scenarios in Chromium; E2E_LANG=ro for the Romanian UI
```

`npm test` needs no `npm install`: it only uses Node.js 20 or newer.

The end-to-end tests need Chromium or Chrome for Testing, because Google Chrome ignores `--load-extension` since version 137. Interception is simulated on a single machine: the browser visits a server with a "Contoso Inspection CA" certificate, while the notary is pointed at the server with the "real" certificate.

## Build and publish

```bash
node scripts/build.mjs      # dist/ssl-checker-1.0.0.zip and dist/ssl-checker-lite-1.0.0.zip
```

On Windows you can double-click `build\package.cmd` instead (it needs Node.js 20 or newer). From a terminal, `build\package.cmd full` or `build\package.cmd lite` builds a single package.

Chrome Web Store steps, listing texts and screenshots: [`store/PUBLISHING.md`](store/PUBLISHING.md).

## Known limitations

- While the certificate is read locally, Chrome shows its debugging bar for a few seconds; it cannot be hidden without command-line flags.
- Certificate error pages and Chrome's internal pages cannot be read locally; only the notaries are used there.
- A Chrome that has not updated its list of CT logs reports "unknown" even for public certificates; the verdict stays cautious, and the comparison with notaries makes the difference.
- A notary on the same network as you sees the same interception; put notaries on different networks and in different countries.
