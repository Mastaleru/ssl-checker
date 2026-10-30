# SSL Checker

A Chrome extension (Manifest V3) that shows the TLS certificate of the site in the current tab — the one your browser **actually received** — and tells you whether something between you and the site is replacing it: a company proxy, an antivirus or something else.

## Features

- **The real certificate.** Reads the certificate chain your browser received for the current tab, with the connection details: TLS version, key exchange (including post-quantum hybrids), cipher, Encrypted Client Hello and Certificate Transparency status.
- **Interception detection.** Compares that certificate with what notary servers see from elsewhere on the internet: the PlusPrivacy notary by default, and any notary you add. A different certificate that is not publicly logged means the traffic is decrypted and re-signed on your path; known inspection products (corporate proxies, cloud gateways, antivirus, debugging proxies) are named.
- **Signed answers.** The PlusPrivacy notary signs every answer, and the extension checks the signature against the key it carries. An interceptor cannot fake a confirmation; if it changes an answer, the popup says so.
- **Site memory.** Remembers which certificate authority each site you check uses, and warns you when a site you know suddenly arrives with a different one, even without notaries. Nothing is recorded in incognito windows.
- **One clear verdict.** A single verdict at the top, plus warnings for expired or expiring certificates, names not covered, SHA-1 or MD5 signatures, short RSA keys and TLS 1.0/1.1.
- **Every detail.** Validity, validation level (DV, OV, EV), the full chain, SHA-256 and SHA-1 fingerprints, the public key pin, serial number, OCSP and CRL addresses, SCTs and all extensions. Copy the PEM or download the whole chain.
- **You decide when the debugger runs.** Reading the certificate from the browser needs Chrome's debugger, so it can run every time, on demand or never. A lite package without the debugger permission is built as well.
- **Your own notaries.** Any server that speaks the notary protocol can be a source, and given its key, its answers are checked too. The one in [`notary/`](notary/README.md), which also runs the PlusPrivacy notary, is a small Express service packaged for Docker.
- **Private by design.** No analytics, no account, no host permissions. Nothing is read or sent before you agree in the popup. Only the host name and port go to the notaries (PlusPrivacy's unless you turn it off, and any you add), and the site memory stays on the device.
- **English and Romanian** user interface.

## Try it

`chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select the `extension/` folder. Open an HTTPS site and click the toolbar icon. Chrome 137 or newer is needed (it brought Ed25519 to Web Crypto, which checks the notaries' signatures).

## How it works

**Agreement first.** Before the first check, the popup says what a check reads and sends, and asks you to agree. The PlusPrivacy notary and the site memory are shown as choices that start on and can be turned off right there. Nothing is read or sent before you agree: the Chrome Web Store has required this disclosure and consent inside the extension since August 2026. The agreement is stored with a version (`CONSENT_VERSION` in `lib/settings.js`); raising it asks everyone again, as the store requires when data practices change.

**Local reading.** Chrome has no extension API for the certificate of a loaded page, so the extension attaches `chrome.debugger` to the tab for about a second: `Network.enable`, a cookie-less `HEAD /favicon.ico` request sent from an isolated world (the page cannot intercept it), then `Network.getCertificate`. The page's service worker is bypassed, so the response comes from the network. Pages with a strict Content Security Policy block that request; for them the popup offers "Reload page and read". The mode is chosen in Options: _every time_, _on demand_ or _never_. Chrome does not allow `debugger` as an optional permission, which is why there is also a lite package without it.

**Notaries.** Each endpoint receives `?host=&port=&nonce=` (or a URL template with `{host}` and `{port}`) and returns the certificate chain it sees from where it runs. The PlusPrivacy notary at `notary.plusprivacy.com` is built in (`lib/default-notary.js`), is asked first, and can be turned off in Options. It runs the service in `notary/`, whose README describes the protocol, the protection against abuse and the deployment on a VPS. Options links to that folder on GitHub, next to "Add a source", for anyone who wants to run a notary of their own.

**Signed answers.** The notary signs each answer with its Ed25519 key, and the answer repeats the request's random nonce. For a notary whose keys it knows (always PlusPrivacy, whose keys are built into `lib/default-notary.js`, and any source given a key in Options), the extension uses an answer only when the signature holds, the nonce is the one it sent, and the host and port are the ones it asked (`lib/notary-signature.js`). The proxy that re-signs a site can intercept the notary's HTTPS connection too, but it cannot fake an answer: a changed answer, an old one replayed, or one about the interceptor's own server is refused. Since only something that intercepts the browser's secure connections can do that, the verdict becomes **An answer was changed on the way**. An unsigned answer, or one signed with an unknown key, is refused without that alarm. For a certificate that is not publicly logged, only what an interceptor cannot fake confirms it: a signed answer with the same certificate or key. An interceptor can copy an issuer's name and write an unsigned answer, so neither confirms such a certificate on its own, nor outweighs a signed answer that differs; and a certificate made by a known inspection product is reported whatever the notaries say. Sources without a key remain useful for publicly logged certificates. Error answers are not signed, so the extension accepts only the protocol's error codes and never shows their text. A build without a key for PlusPrivacy never asks it, and `scripts/build.mjs` warns about it.

**Site memory.** For every site checked with local reading, the extension remembers which certificate authority issued the certificate, in `chrome.storage.local` on the device. It remembers the authority, not the certificate, because certificates are renewed every few months: the authority is identified by the organization in the issuer name, and the keys of its issuing certificates are kept too, so a look-alike authority that borrows a known name is still told apart. A change towards another public (CT-logged) authority is only noted and learned. A change towards a certificate that is not publicly logged is not learned: the popup shows the change and offers "Trust it for this site" and "Forget this site". It can be turned off and wiped in Options; records unseen for 400 days are dropped, and at most 5,000 sites are kept. Tabs in incognito windows never read or update the memory: Chrome shares extension storage between normal and incognito windows, so anything recorded there would outlive the private session.

**The verdict** compares the SHA-256 fingerprint and the public key (SPKI) of the local certificate with the notaries' ones, then the issuer. Certificate Transparency tells whether the local certificate is public: Chrome reports "compliant" only for publicly logged certificates, and "unknown" for locally installed roots, which is exactly where interceptors live.

| Situation                                                                                  | Verdict                                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Same certificate (or same key) as the notaries                                             | Confirmed                                                                                        |
| Different certificate, same issuer, publicly logged                                        | Same issuer (normal behind CDNs)                                                                 |
| Different certificate, same issuer name, not confirmed as public                           | Same issuer name, not confirmed (a warning)                                                      |
| Different from every notary, not confirmed as public                                       | **Connection likely intercepted** (names the issuer and, when known, the product)                |
| Not confirmed as public, issued by a known inspection product, whatever the notaries say   | **Intercepted by** the product                                                                   |
| Different from every notary, but public                                                    | Sources see different certificates                                                               |
| Same as some notaries, different from others, not confirmed as public                      | Sources disagree (explains both possibilities)                                                   |
| Same as some notaries, different from others, public                                       | Confirmed, with a note about the sources that differ                                             |
| No notaries: public / not confirmed as public                                              | Publicly logged certificate / Not confirmed as a public certificate                              |
| Notaries only (local reading off or failed)                                                | Seen by external sources                                                                         |
| Plain HTTP page                                                                            | Unencrypted page (plus the certificate on port 443, if any)                                      |
| Site memory: the site had a public certificate before, now one that is not publicly logged | **Certificate authority changed** (also when a known authority name appears with an unknown key) |
| Site memory: another authority, neither of them public                                     | Warning in the list, plus "Trust it for this site"                                               |
| Site memory: another public authority                                                      | Note in the list; the new authority is remembered                                                |
| A signed notary answer was changed on the way, replayed, or made for another site          | **An answer was changed on the way** (when nothing worse was found; otherwise a warning)         |
| Only unsigned answers agree, and the certificate is not confirmed as public                | Confirmed only by unsigned answers (a warning)                                                   |
| A signed answer differs and only unsigned ones agree, not confirmed as public              | **Connection likely intercepted**                                                                |

Additional warnings: expired or expiring soon, name not covered, SHA-1 or MD5 in the chain, RSA keys under 2048 bits, TLS 1.0/1.1, a notary that does not trust what it sees.

## Permissions

| Permission  | Used for                                                                     |
| ----------- | ---------------------------------------------------------------------------- |
| `activeTab` | The address of the tab being checked, only after you click the icon          |
| `storage`   | Settings, the last result of each tab and the site memory, all on the device |
| `debugger`  | Reading the certificate from the browser (not included in the lite package)  |

There are no host permissions, so notaries must send CORS headers.

## Project layout

```
extension/              what Chrome loads (Load unpacked) and what gets packaged
  manifest.json
  background/           service worker: local reading (chrome.debugger), notary queries
  lib/                  X.509 parser, verdict, notary signatures, site memory, host names, known interceptors, settings, i18n
  popup/  options/  ui/ user interface
  _locales/{en,ro}/     messages
  fonts/  icons/
notary/                 the notary service (Express), its Docker and VPS setup, and its own tests
scripts/
  build.mjs             builds the full and the lite package into dist/
  notary-image.mjs      builds the notary's Docker image into dist/, to upload to the VPS
build/package.cmd       Windows shortcut for scripts/build.mjs
store/                  Chrome Web Store texts, screenshots, privacy policy and publishing guide
.github/workflows/      CI on every push and pull request; release on version tags
tests/                  unit and end-to-end (Chromium) tests of the extension
```

## Tests

```bash
npm test                    # X.509 parser (checked against pyca/cryptography), verdict, site memory, translations, settings, signatures
npm ci --prefix notary
npm run test:notary         # the notary: configuration, SSRF ranges, bans, capacity, the HTTP API, signing
npm install && npx playwright install chromium
npm run test:e2e            # 18 scenarios in Chromium; E2E_LANG=ro for the Romanian UI
```

`npm test` needs no `npm install`: it only uses Node.js 20 or newer. The notary needs Node.js 22 or newer.

GitHub Actions runs all of it on every push and pull request (`.github/workflows/ci.yml`): lint, the unit tests on Node.js 20 and 24, the notary tests on Node.js 22 and 24, and the end-to-end tests in English and Romanian. Screenshots of a failed end-to-end run are kept as an artifact for a week.

The end-to-end tests need Chromium or Chrome for Testing, because Google Chrome ignores `--load-extension` since version 137. They start two real notary processes, each with its own signing key: a private one with a token, and a public one that stands in for PlusPrivacy's (the staged extension is pointed at it, with its key). Interception is simulated on a single machine: the browser visits a server with a "Contoso Inspection CA" certificate, while the notary is pointed at the server with the "real" certificate. Between the extension and the PlusPrivacy stand-in sits a proxy that plays the interceptor: it rewrites the chain in the answer, sends the notary to another server, replays an old answer or drops the signature, and each attempt must be caught. For the site memory, one server swaps its certificate between two checks, and a check in an incognito window confirms that nothing is recorded there (that scenario loads the extension through the DevTools protocol, the only way to allow it in incognito from a test).

## Code style

Prettier formats the code and the other files it supports (`.prettierrc.json`: lines up to 120 characters, single quotes). ESLint (`eslint.config.mjs`) runs its recommended rules, which catch likely mistakes such as undefined or unused variables, and requires braces around the body of every `if`, `else`, `for`, `while` and `do`, which Prettier never adds. Each part of the code is checked against the globals of the place where it runs: the service worker and `lib/` have no DOM, the popup and options pages do, and the notary, build, tests and store tools run in Node.js.

```bash
npm install
npm run lint                # ESLint and the Prettier check; changes nothing
npm run format              # fixes what ESLint can fix (braces included), then formats with Prettier
```

The commit that reformatted the whole project is listed in `.git-blame-ignore-revs`: GitHub's blame view skips it, and `git config blame.ignoreRevsFile .git-blame-ignore-revs` makes `git blame` skip it too.

## Build and publish

```bash
node scripts/build.mjs      # dist/ssl-checker-<version>.zip and dist/ssl-checker-lite-<version>.zip
npm run notary:image        # dist/ssl-checker-notary-<version>-linux-amd64.tar.gz, the notary's Docker image for the VPS
```

On Windows you can double-click `build\package.cmd` instead (it needs Node.js 20 or newer). From a terminal, `build\package.cmd full` or `build\package.cmd lite` builds a single package. The version comes from `extension/manifest.json`.

### Releases

A version tag publishes a GitHub Release (`.github/workflows/release.yml`):

```bash
npm run release:check -- v2.0.1     # after raising the version in extension/manifest.json and package.json
git tag v2.0.1 && git push origin v2 v2.0.1
```

The workflow runs every CI job first; only when all of them pass does it check the tag against the version, check that the PlusPrivacy key is built in, build both packages, and publish them with `SHA256SUMS.txt` and a signed build provenance attestation. Anyone can check that a package was built here, from that commit: `gh attestation verify ssl-checker-<version>.zip --repo Mastaleru/ssl-checker`. The build is reproducible, so `node scripts/build.mjs` at the tag gives the same bytes. Uploading to the Chrome Web Store stays manual. In the repository settings, a tag ruleset that lets only maintainers create `v*` tags, and immutable releases, keep the published packages as they were built.

Chrome Web Store steps, listing texts and screenshots: [`store/PUBLISHING.md`](store/PUBLISHING.md). Deploy the PlusPrivacy notary first ([`notary/README.md`](notary/README.md)) and copy its public key into `extension/lib/default-notary.js`: the extension asks it by default, and only with its key.

## Known limitations

- While the certificate is read locally, Chrome shows its debugging bar for a few seconds; it cannot be hidden without command-line flags.
- Certificate error pages and Chrome's internal pages cannot be read locally; only the notaries are used there.
- A Chrome that has not updated its list of CT logs reports "unknown" even for public certificates; the verdict stays cautious, and the comparison with notaries makes the difference.
- A notary on the same network as you sees the same interception; put notaries on different networks and in different countries.
- Signatures stop an interceptor from faking a notary's answer, not from blocking it. A blocked notary shows as unreachable, and the verdict rests on the other signals.
