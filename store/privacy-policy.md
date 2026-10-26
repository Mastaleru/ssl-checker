# SSL Checker — Privacy policy / Politica de confidențialitate

_Last updated / Ultima actualizare: 26 October 2026_

## English

SSL Checker is a browser extension that shows the TLS certificate of the website in your active tab and compares it with what independent notary servers see.

**What the extension reads.** Only when you open its popup: the address of the active tab (to know which site to check) and, if reading from the browser is enabled, the certificate chain and connection parameters of that tab, read through Chrome's debugger interface. It does not read page content, cookies, passwords, form data, other tabs or your browsing history.

**What leaves your device.** The host name and port of the site you check are sent only to the notary servers you add in Options, together with the access token you entered for that server, if any. No notary is configured by default. Nothing is sent to the developer of SSL Checker. There is no analytics, tracking, advertising or account.

**What is stored.** Your settings (reading mode, notary addresses and tokens, timeout) are stored with `chrome.storage.local` on your device. The result of the last check for each tab is kept with `chrome.storage.session` and is deleted when you close the tab or the browser.

**Third parties.** The notary servers you add are operated by you or by whoever you choose; their own policies apply. The reference notary implementation does not store requests and does not log site names unless its operator turns that on.

**Contact.** [your contact e-mail]

## Română

SSL Checker este o extensie de browser care afișează certificatul TLS al site-ului din tabul activ și îl compară cu ce văd servere notar independente.

**Ce citește extensia.** Doar când îi deschizi popup-ul: adresa tabului activ (ca să știe ce site verifică) și, dacă citirea din browser e activă, lanțul de certificate și parametrii conexiunii acelui tab, prin interfața de depanare a Chrome. Nu citește conținutul paginilor, cookie-uri, parole, date din formulare, alte taburi sau istoricul de navigare.

**Ce pleacă de pe dispozitivul tău.** Numele site-ului verificat și portul sunt trimise doar serverelor notar pe care le adaugi în Opțiuni, împreună cu tokenul de acces introdus pentru acel server, dacă există. Implicit nu e configurat niciun notar. Nimic nu este trimis dezvoltatorului SSL Checker. Nu există analytics, urmărire, reclame sau cont.

**Ce se păstrează.** Setările (modul de citire, adresele și tokenurile notarilor, timpul de așteptare) sunt păstrate cu `chrome.storage.local` pe dispozitivul tău. Rezultatul ultimei verificări pentru fiecare tab e păstrat cu `chrome.storage.session` și se șterge când închizi tabul sau browserul.

**Terți.** Serverele notar pe care le adaugi sunt operate de tine sau de cine alegi tu; se aplică politicile lor. Implementarea de referință a notarului nu păstrează cererile și nu scrie site-urile în jurnal decât dacă operatorul activează asta.

**Contact.** [adresa ta de e-mail de contact]
