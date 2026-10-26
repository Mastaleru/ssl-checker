# SSL Checker 1.0

Extensie Chrome (Manifest V3) care arată certificatul TLS al site-ului din tabul curent — cel primit **cu adevărat** de browser — și îl compară cu ce văd servere „notar” independente, ca să detecteze interceptarea HTTPS (proxy de firmă, antivirus, altceva).

## Ce s-a schimbat față de 0.3

| 0.3 (2017) | 1.0 |
|---|---|
| Manifest V2, oprit de Chrome 138 și scos din Store pe 31.08.2026 | Manifest V3, service worker, module ES |
| Scraping pe HTML-ul sslchecker.com | Certificatul citit direct din Chrome + notari configurabili, cu protocol JSON documentat |
| jQuery 3.2.1 și Bootstrap (cu vulnerabilități cunoscute), `innerHTML` cu date externe | Zero dependențe, DOM construit doar cu `textContent` |
| Permisiune pe sslchecker.com | `activeTab`, `storage`, `debugger` (sau fără `debugger` în varianta lite); nicio permisiune pe site-uri |
| Doar engleză | Engleză și română |

## Structura

```
extension/              ← asta se încarcă în Chrome (Load unpacked) și se împachetează
  manifest.json
  background/           service worker: citire locală (chrome.debugger), interogare notari
  lib/                  parser X.509, verdict, hostname-uri, interceptoare cunoscute, setări, i18n
  popup/  options/  ui/ interfața
  _locales/{en,ro}/     texte
  fonts/  icons/
notary/                 serverul notar de referință (un fișier Node.js) + Dockerfile + README
scripts/build.mjs       construiește dist/ssl-checker-<v>.zip și varianta lite
store/                  texte, capturi, politica de confidențialitate, ghidul de publicare
tests/                  teste unitare, de integrare (notar) și cap-coadă (Chromium)
```

## Încărcare locală

`chrome://extensions` → **Developer mode** → **Load unpacked** → folderul `extension/`. Deschide un site HTTPS și apasă pe iconiță.

## Cum funcționează

**Citirea locală.** Chrome nu are API pentru certificatul unei pagini, așa că extensia atașează `chrome.debugger` la tab cam o secundă: `Network.enable`, o cerere `HEAD /favicon.ico` fără cookie-uri dintr-o lume izolată (pagina nu o poate intercepta), apoi `Network.getCertificate`. Service worker-ul paginii e ocolit, ca răspunsul să vină din rețea. Pe paginile cu CSP strict cererea e blocată, iar popup-ul oferă „Reîncarcă pagina și citește”. Modul se alege în Opțiuni: *de fiecare dată*, *la cerere* sau *niciodată*. (`debugger` nu poate fi permisiune opțională în Chrome, de aceea există și pachetul lite fără ea.)

**Notarii.** Fiecare endpoint primește `?host=&port=` (sau un șablon cu `{host}`/`{port}`) și întoarce lanțul de certificate văzut din locul lui. Protocolul și serverul de referință sunt în [`notary/README.md`](notary/README.md).

**Verdictul** compară amprenta SHA-256 și cheia publică (SPKI) ale certificatului local cu ale notarilor, apoi emitentul. Certificate Transparency spune dacă certificatul local e public: Chrome raportează „compliant” doar pentru certificate înregistrate public; pentru rădăcini instalate local (exact unde stau interceptoarele) raportează „unknown”.

| Situație | Verdict |
|---|---|
| Același certificat (sau aceeași cheie) ca notarii | Confirmat |
| Alt certificat, același emitent | Același emitent (normal la CDN-uri) |
| Diferit de toți notarii, neconfirmat public | **Conexiune probabil interceptată** (numește emitentul și, dacă e cunoscut, produsul) |
| Diferit de toți notarii, dar public | Surse cu certificate diferite |
| Identic cu unii notari, diferit de alții, neconfirmat public | Sursele nu sunt de acord (explică ambele ipoteze) |
| Identic cu unii, diferit de alții, public | Confirmat, cu notă despre sursele care diferă |
| Fără notari: public / neconfirmat public | Certificat public / Neconfirmat ca public |
| Doar notari (citirea locală oprită sau eșuată) | Văzut din surse externe |
| Pagină HTTP | Pagină necriptată (+ certificatul de pe 443, dacă există) |

Avertismente suplimentare: expirat / expiră în curând, numele nu e acoperit, SHA-1/MD5 în lanț, RSA sub 2048 de biți, TLS 1.0/1.1, notar care nu are încredere în ce vede.

## Teste

```bash
npm test                    # parser X.509 (comparat cu pyca/cryptography), verdict, traduceri, notar
npm install && npx playwright install chromium
npm run test:e2e            # 13 scenarii în Chromium; E2E_LANG=ro pentru interfața în română
```

`npm test` nu are nevoie de `npm install`: folosește doar Node.js 20+.

Testele cap-coadă au nevoie de Chromium sau Chrome for Testing: Google Chrome de la versiunea 137 ignoră `--load-extension`. Interceptarea e simulată pe o singură mașină: browserul vizitează un server cu certificat „Contoso Inspection CA”, iar notarul e îndreptat spre serverul cu certificatul „real”.

## Build și publicare

```bash
node scripts/build.mjs      # dist/ssl-checker-1.0.0.zip și dist/ssl-checker-lite-1.0.0.zip
```

Pașii pentru Chrome Web Store, textele și capturile: [`store/PUBLICARE.md`](store/PUBLICARE.md).

## Limitări cunoscute

- La citirea locală Chrome afișează bara de depanare câteva secunde; nu se poate ascunde fără flag-uri de linie de comandă.
- Paginile de eroare pentru certificat și paginile interne Chrome nu pot fi citite local; acolo rămân doar notarii.
- Un Chrome care nu și-a actualizat lista de jurnale CT raportează „unknown” și pentru certificate publice; verdictul rămâne prudent, iar comparația cu notarii face diferența.
- Un notar aflat în aceeași rețea cu tine vede aceeași interceptare; pune notarii în rețele și țări diferite.
