# Chrome Web Store listing

Texts ready to paste into Developer Dashboard → **Store listing**. English is the default language (`default_locale: en`); Romanian is added as a localization. The name and the short description come from `_locales/*/messages.json` (`extName`, `extDescription`) automatically.

- **Category:** Developer Tools
- **Default language:** English
- **Screenshots:** `store/screenshots/en/1-…4-*.png` and `store/screenshots/ro/…` (1280×800)
- **Small promo tile:** `store/screenshots/<language>/promo-440x280.png`
- **Icon:** `extension/icons/ssl128.png`
- **Homepage URL:** `https://sslchecker.plusprivacy.com/`

---

## English

**Name:** SSL Checker

**Summary (132 max):** See the real TLS certificate of the current site and detect interception by comparing it with independent notaries.

**Description (2,000 max):**

SSL Checker shows the TLS certificate of the site in your current tab — the one your browser actually received — and tells you whether something between you and the site is replacing it.

WHAT YOU SEE
• The certificate: names, issuer, validity, validation level (DV, OV, EV), key and signature algorithms.
• The connection: TLS version, key exchange (post-quantum hybrids included), cipher, Encrypted Client Hello, Certificate Transparency.
• The full chain, fingerprints, serial number and all extensions. Copy the PEM or download the chain.

CATCH INTERCEPTION
SSL Checker asks the PlusPrivacy notary, and any notary you add, which certificate the same site shows them from elsewhere on the internet, and compares:
• Same certificate everywhere → confirmed.
• Yours is different and not publicly logged → your HTTPS traffic is decrypted and re-signed (company proxy, antivirus or worse), and SSL Checker names the authority that issued the replacement.

REMEMBERS THE SITES YOU CHECK
SSL Checker remembers each site's certificate authority and warns you when a known site suddenly arrives with another one. The memory stays on your device; incognito windows are never recorded.

YOU DECIDE WHEN THE DEBUGGER RUNS
Chrome has no API for a loaded page's certificate, so SSL Checker attaches Chrome's debugger to the tab for about a second, and Chrome shows its debugging bar meanwhile. In Options: every time, on demand, or never (notaries only).

SIGNED ANSWERS
The PlusPrivacy notary signs every answer and SSL Checker checks the signature, so nobody on the way can fake a confirmation. The notary is open source: run your own and add it with its key.

PRIVACY
No analytics, no tracking, no account. Before the first check, SSL Checker says what it reads and sends and asks for your agreement. Only the checked site's host name and port leave your device, for the notaries. The PlusPrivacy notary keeps no record of them and can be turned off.

---

## Romanian (`ro` localization)

These are the texts for the Romanian localization of the listing, so they stay in Romanian.

**Name:** SSL Checker

**Summary (132 max):** Vezi certificatul TLS real al site-ului curent și detectează interceptarea, comparându-l cu notari independenți.

**Description (2,000 max):**

SSL Checker îți arată certificatul TLS al site-ului din tabul curent — cel primit de fapt de browserul tău — și îți spune dacă ceva dintre tine și site îl înlocuiește.

CE VEZI
• Certificatul: numele, emitentul, valabilitatea, nivelul de validare (DV, OV, EV), algoritmii de cheie și semnătură.
• Conexiunea: versiunea TLS, schimbul de chei (inclusiv hibrizi post-cuantici), cifrul, Encrypted Client Hello, Certificate Transparency.
• Lanțul complet, amprentele, numărul de serie și toate extensiile. Copiezi PEM-ul sau descarci lanțul.

PRINDE INTERCEPTAREA
SSL Checker întreabă notarul PlusPrivacy și notarii adăugați de tine ce certificat le arată același site din alt punct al internetului, apoi compară:
• Același certificat peste tot → confirmat.
• Al tău e diferit și neînregistrat public → traficul tău HTTPS e decriptat și re-semnat (proxy de firmă, antivirus sau mai rău), iar SSL Checker numește autoritatea care a emis înlocuitorul.

ȚINE MINTE SITE-URILE VERIFICATE
SSL Checker ține minte autoritatea de certificare a fiecărui site și te avertizează când un site cunoscut apare brusc cu alta. Memoria rămâne pe dispozitiv și ignoră ferestrele incognito.

TU DECIZI CÂND RULEAZĂ DEBUGGER-UL
Chrome nu are un API pentru certificatul unei pagini, așa că SSL Checker atașează debugger-ul la tab cam o secundă; între timp, Chrome afișează bara de depanare. În Opțiuni: de fiecare dată, la cerere sau niciodată (doar notari).

RĂSPUNSURI SEMNATE
Notarul PlusPrivacy semnează fiecare răspuns și SSL Checker verifică semnătura, așa că nimeni de pe drum nu poate falsifica o confirmare. Notarul e open source: instalează-ți unul propriu și adaugă-l cu cheia lui.

CONFIDENȚIALITATE
Fără analytics, fără urmărire, fără cont. Înainte de prima verificare, îți spune ce citește și ce trimite și îți cere acordul. Doar numele site-ului verificat și portul pleacă de pe dispozitiv, către notari. Notarul PlusPrivacy nu le păstrează și îl poți opri.

---

## Lite variant (optional, separate item)

If you also publish `ssl-checker-lite-<version>.zip`, its name comes from `extNameLite` ("SSL Checker Lite") and its summary from `extDescriptionLite`. Use the same description without the "You decide when the debugger runs" section, and state that this variant reads certificates only through notary servers: the PlusPrivacy notary by default, and any you add.
