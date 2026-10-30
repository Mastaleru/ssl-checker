# Chrome Web Store listing

Texts ready to paste into Developer Dashboard → **Store listing**. English is the default language (`default_locale: en`); Romanian is added as a localization. The name and the short description come from `_locales/*/messages.json` (`extName`, `extDescription`) automatically.

- **Category:** Developer Tools
- **Default language:** English
- **Screenshots:** `store/screenshots/en/1-…4-*.png` and `store/screenshots/ro/…` (1280×800)
- **Small promo tile:** `store/screenshots/<language>/promo-440x280.png`
- **Icon:** `extension/icons/ssl128.png`

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
SSL Checker asks the PlusPrivacy notary, and any notary server you add, which certificate the same site presents to them. Each one connects to the site from elsewhere on the internet. SSL Checker compares the fingerprints:
• Same certificate everywhere → confirmed.
• Your certificate is different and not publicly logged → your HTTPS traffic is being decrypted and re-signed (company proxy, antivirus, or worse), and SSL Checker shows which authority issued the replacement. Known inspection products are named.
• Sources that disagree with each other are reported as such, with an explanation of what each case can mean.

REMEMBERS THE SITES YOU CHECK
SSL Checker remembers which certificate authority each site you check uses, and warns you when a site you know suddenly arrives with a different one, for example on a new Wi-Fi network. This memory stays on your device, is never used in incognito windows, and can be turned off or wiped in Options.

YOU DECIDE WHEN THE DEBUGGER RUNS
Chrome has no dedicated API for the certificate of a loaded page, so SSL Checker attaches Chrome's debugger to the tab for about a second when it reads one. While it does, Chrome shows a bar saying the extension is debugging the browser. In Options you choose: every time, on demand (one click in the popup), or never (external sources only).

NOTARY SERVERS
The PlusPrivacy notary is built in, and you can turn it off in Options. Any server that implements the small notary protocol described in Options can be added as a source. The notary software (Node.js in a Docker container, protected against SSRF and floods) is available from the developer. The PlusPrivacy notary signs every answer and SSL Checker checks the signature, so nobody on the way can fake a confirmation. Give a notary you add its key, and its answers are checked the same way.

PRIVACY
No analytics, no tracking, no account. Before the first check, SSL Checker tells you what it reads and sends, and asks for your agreement. Only the checked site's host name and port leave your device: they go to the PlusPrivacy notary, which keeps no record of the sites, unless you turn it off, and to the notaries you add. The site memory never leaves your device.

---

## Romanian (`ro` localization)

These are the texts for the Romanian localization of the listing, so they stay in Romanian.

**Name:** SSL Checker

**Summary (132 max):** Vezi certificatul TLS real al site-ului curent și detectează interceptarea, comparându-l cu notari independenți.

**Description:**

SSL Checker îți arată certificatul TLS al site-ului din tabul curent — cel pe care browserul tău l-a primit cu adevărat — și îți spune dacă ceva dintre tine și site îl înlocuiește.

CE VEZI
• Certificatul așa cum l-a primit Chrome: numele acoperite, emitentul, valabilitatea și zilele rămase, nivelul de validare (DV, OV, EV), algoritmii de cheie și de semnătură.
• Conexiunea: versiunea TLS, schimbul de chei (inclusiv hibrizii post-cuantici), cifrul, Encrypted Client Hello și statusul Certificate Transparency.
• Lanțul complet, amprentele SHA-256 și SHA-1, pinul cheii publice, numărul de serie, adresele OCSP și CRL, SCT-urile și toate extensiile. Copiezi PEM-ul sau descarci tot lanțul.

PRINDE INTERCEPTAREA
SSL Checker întreabă notarul PlusPrivacy și orice server notar adaugi tu ce certificat le prezintă același site. Fiecare se conectează la site din alt punct al internetului. SSL Checker compară amprentele:
• Același certificat peste tot → confirmat.
• Certificatul tău e diferit și neînregistrat public → traficul tău HTTPS e decriptat și re-semnat (proxy de firmă, antivirus sau mai rău), iar SSL Checker arată ce autoritate a emis înlocuitorul. Produsele de inspecție cunoscute sunt numite.
• Sursele care nu sunt de acord între ele sunt raportate ca atare, cu explicația fiecărui caz posibil.

ȚINE MINTE SITE-URILE VERIFICATE
SSL Checker ține minte ce autoritate de certificare folosește fiecare site pe care îl verifici și te avertizează când un site cunoscut apare brusc cu alta, de exemplu într-o rețea Wi-Fi nouă. Memoria rămâne pe dispozitivul tău, nu e folosită niciodată în ferestrele incognito și poate fi oprită sau ștearsă din Opțiuni.

TU DECIZI CÂND RULEAZĂ DEBUGGER-UL
Chrome nu are un API dedicat pentru certificatul unei pagini încărcate, așa că SSL Checker atașează debugger-ul Chrome la tab cam o secundă când îl citește. Între timp, Chrome afișează o bară care spune că extensia depanează browserul. În Opțiuni alegi: de fiecare dată, la cerere (un clic în popup) sau niciodată (doar surse externe).

SERVERE NOTAR
Notarul PlusPrivacy e inclus și îl poți opri din Opțiuni. Orice server care implementează micul protocol de notar descris în Opțiuni poate fi adăugat ca sursă. Programul notarului (Node.js într-un container Docker, protejat împotriva SSRF și a avalanșelor de cereri) e disponibil de la dezvoltator. Notarul PlusPrivacy își semnează fiecare răspuns, iar SSL Checker verifică semnătura, așa că nimeni de pe drum nu poate falsifica o confirmare. Dacă dai cheia unui notar pe care îl adaugi, și răspunsurile lui sunt verificate la fel.

CONFIDENȚIALITATE
Fără analytics, fără urmărire, fără cont. Înainte de prima verificare, SSL Checker îți spune ce citește și ce trimite și îți cere acordul. Doar numele site-ului verificat și portul pleacă de pe dispozitivul tău: la notarul PlusPrivacy, care nu păstrează nicio evidență a site-urilor, dacă nu îl oprești, și la notarii pe care îi adaugi. Memoria site-urilor nu părăsește dispozitivul tău.

---

## Lite variant (optional, separate item)

If you also publish `ssl-checker-lite-<version>.zip`, its name comes from `extNameLite` ("SSL Checker Lite") and its summary from `extDescriptionLite`. Use the same description without the "You decide when the debugger runs" section, and state that this variant reads certificates only through notary servers: the PlusPrivacy notary by default, and any you add.
