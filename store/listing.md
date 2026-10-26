# Fișa din Chrome Web Store

Texte gata de copiat în Developer Dashboard → **Store listing**. Engleza e limba implicită (`default_locale: en`); româna se adaugă ca localizare. Numele și descrierea scurtă vin automat din `_locales/*/messages.json` (`extName`, `extDescription`).

- **Categorie:** Developer Tools
- **Limbă implicită:** English
- **Capturi:** `store/screenshots/en/1-…4-*.png` și `store/screenshots/ro/…` (1280×800)
- **Tile promo mic:** `store/screenshots/<limbă>/promo-440x280.png`
- **Iconiță:** `extension/icons/ssl128.png`

---

## English

**Name:** SSL Checker

**Summary (132 max):** See the real TLS certificate of the current site and detect interception by comparing it with independent notaries.

**Description:**

SSL Checker shows the TLS certificate of the site in your current tab — the one your browser actually received — and tells you whether something between you and the site is replacing it.

WHAT YOU SEE
• The certificate as Chrome received it: names covered, issuer, validity and days left, validation level (DV, OV, EV), key and signature algorithms.
• The connection: TLS version, key exchange (including post-quantum hybrids), cipher, Encrypted Client Hello and Certificate Transparency status.
• The full chain, SHA-256 and SHA-1 fingerprints, the public key pin, serial number, OCSP and CRL addresses, SCTs and every extension. Copy the PEM or download the whole chain.

CATCH INTERCEPTION
Add notary servers you trust. Each one connects to the same site from elsewhere on the internet and reports the certificate it receives. SSL Checker compares the fingerprints:
• Same certificate everywhere → confirmed.
• Your certificate is different and not publicly logged → your HTTPS traffic is being decrypted and re-signed (company proxy, antivirus, or worse), and SSL Checker shows which authority issued the replacement. Known inspection products are named.
• Sources that disagree with each other are reported as such, with an explanation of what each case can mean.

YOU DECIDE WHEN THE DEBUGGER RUNS
Chrome has no dedicated API for the certificate of a loaded page, so SSL Checker attaches Chrome's debugger to the tab for about a second when it reads one. While it does, Chrome shows a bar saying the extension is debugging the browser. In Options you choose: every time, on demand (one click in the popup), or never (external sources only).

NOTARY SERVERS
Any server that implements the small notary protocol described in Options can be a source. A reference implementation (one Node.js file, no dependencies, protected against SSRF, with optional token and rate limiting) is available from the developer.

PRIVACY
No analytics, no tracking, no account, nothing sent to the developer. Only the site's host name and port are sent, and only to the notary servers you configure.

---

## Română

**Nume:** SSL Checker

**Rezumat (max. 132):** Vezi certificatul TLS real al site-ului curent și detectează interceptarea, comparându-l cu notari independenți.

**Descriere:**

SSL Checker îți arată certificatul TLS al site-ului din tabul curent — cel pe care browserul tău l-a primit cu adevărat — și îți spune dacă ceva dintre tine și site îl înlocuiește.

CE VEZI
• Certificatul așa cum l-a primit Chrome: numele acoperite, emitentul, valabilitatea și zilele rămase, nivelul de validare (DV, OV, EV), algoritmii de cheie și de semnătură.
• Conexiunea: versiunea TLS, schimbul de chei (inclusiv hibrizii post-cuantici), cifrul, Encrypted Client Hello și statusul Certificate Transparency.
• Lanțul complet, amprentele SHA-256 și SHA-1, pinul cheii publice, numărul de serie, adresele OCSP și CRL, SCT-urile și toate extensiile. Copiezi PEM-ul sau descarci tot lanțul.

PRINDE INTERCEPTAREA
Adaugă servere notar în care ai încredere. Fiecare se conectează la același site din alt punct al internetului și raportează certificatul primit. SSL Checker compară amprentele:
• Același certificat peste tot → confirmat.
• Certificatul tău e diferit și neînregistrat public → traficul tău HTTPS e decriptat și re-semnat (proxy de firmă, antivirus sau mai rău), iar SSL Checker arată ce autoritate a emis înlocuitorul. Produsele de inspecție cunoscute sunt numite.
• Sursele care nu sunt de acord între ele sunt raportate ca atare, cu explicația fiecărui caz posibil.

TU DECIZI CÂND RULEAZĂ DEBUGGER-UL
Chrome nu are un API dedicat pentru certificatul unei pagini încărcate, așa că SSL Checker atașează debugger-ul Chrome la tab cam o secundă când îl citește. Între timp, Chrome afișează o bară care spune că extensia depanează browserul. În Opțiuni alegi: de fiecare dată, la cerere (un clic în popup) sau niciodată (doar surse externe).

SERVERE NOTAR
Orice server care implementează micul protocol de notar descris în Opțiuni poate fi o sursă. O implementare de referință (un singur fișier Node.js, fără dependențe, protejat împotriva SSRF, cu token opțional și limitare de cereri) e disponibilă de la dezvoltator.

CONFIDENȚIALITATE
Fără analytics, fără urmărire, fără cont, nimic trimis dezvoltatorului. Se trimit doar numele site-ului și portul, și doar serverelor notar pe care le configurezi tu.

---

## Varianta Lite (opțională, item separat)

Dacă publici și `ssl-checker-lite-<versiune>.zip`, numele vine din `extNameLite` („SSL Checker Lite”) și rezumatul din `extDescriptionLite`. Folosește aceeași descriere, fără secțiunea „You decide when the debugger runs”, și precizează că varianta citește certificatele doar prin servere notar (deci are nevoie de cel puțin unul configurat).
