# SSL Checker — Privacy policy

_Last updated: 29 October 2026_

The published version is `privacy-policy.html`, which carries the same text and its Romanian translation.

## English

SSL Checker is a browser extension that shows the TLS certificate of the website in your active tab and compares it with what notary servers see from elsewhere on the internet.

**What the extension reads.** Only when you open its popup, and only after you agreed to it there: the address of the active tab (to know which site to check) and, if reading from the browser is enabled, the certificate chain and connection parameters of that tab, read through Chrome's debugger interface. It does not read page content, cookies, passwords, form data, other tabs or your browsing history.

**What leaves your device.** Nothing before you agree. Then, when you check a site, its host name and port are sent to the PlusPrivacy notary (`notary.plusprivacy.com`), run by the developer of SSL Checker, unless you turned it off; and to the notary servers you add in Options, together with the access token you entered for a server, if any. Nothing else is sent to the developer. There is no analytics, tracking, advertising or account.

**The PlusPrivacy notary.** It uses the host name and port only to connect to that site and return the certificate the site presents. It writes nothing to disk and keeps no record of the sites checked. In memory it keeps each answer for 60 seconds, so that a site is not contacted again for every request, and it counts requests per network address to stop abuse; an address that abuses it is blocked for up to 24 hours and appears in its log. All requests to it are encrypted (HTTPS).

**What is stored.** Your agreement and your settings (the PlusPrivacy notary on or off, reading mode, notary addresses and tokens, timeout) are stored with `chrome.storage.local` on your device. The result of the last check for each tab is kept with `chrome.storage.session` and is deleted when you close the tab or the browser. If site memory is on (the default when the certificate is read from the browser), the host name of each site you check and the certificate authority it used (name, key fingerprints, dates and number of checks) are also stored with `chrome.storage.local`, so that SSL Checker can warn you when a site suddenly presents a different authority. Nothing is recorded from incognito windows. This data never leaves your device; you can turn the memory off or delete it in Options, and sites unseen for 400 days are deleted automatically.

**Third parties.** The notary servers you add are operated by you or by whoever you choose; their own policies apply. SSL Checker's use of the data it handles complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

**Contact.** [your contact e-mail]

## Romanian translation

The policy as shown to Romanian-speaking users:

SSL Checker este o extensie de browser care afișează certificatul TLS al site-ului din tabul activ și îl compară cu ce văd servere notar din alte puncte ale internetului.

**Ce citește extensia.** Doar când îi deschizi popup-ul și doar după ce ți-ai dat acordul acolo: adresa tabului activ (ca să știe ce site verifică) și, dacă citirea din browser e activă, lanțul de certificate și parametrii conexiunii acelui tab, prin interfața de depanare a Chrome. Nu citește conținutul paginilor, cookie-uri, parole, date din formulare, alte taburi sau istoricul de navigare.

**Ce pleacă de pe dispozitivul tău.** Nimic înainte să fii de acord. După aceea, când verifici un site, numele lui și portul sunt trimise notarului PlusPrivacy (`notary.plusprivacy.com`), operat de dezvoltatorul SSL Checker, dacă nu l-ai oprit, și serverelor notar pe care le adaugi în Opțiuni, împreună cu tokenul de acces introdus pentru un server, dacă există. Nimic altceva nu este trimis dezvoltatorului. Nu există analytics, urmărire, reclame sau cont.

**Notarul PlusPrivacy.** Folosește numele și portul doar ca să se conecteze la site și să întoarcă certificatul pe care acesta îl prezintă. Nu scrie nimic pe disc și nu păstrează nicio evidență a site-urilor verificate. În memorie păstrează fiecare răspuns 60 de secunde, ca un site să nu fie contactat din nou la fiecare cerere, și numără cererile pe adresă de rețea ca să oprească abuzurile; o adresă care abuzează e blocată cel mult 24 de ore și apare în jurnalul lui. Toate cererile către el sunt criptate (HTTPS).

**Ce se păstrează.** Acordul și setările tale (notarul PlusPrivacy pornit sau oprit, modul de citire, adresele și tokenurile notarilor, timpul de așteptare) sunt păstrate cu `chrome.storage.local` pe dispozitivul tău. Rezultatul ultimei verificări pentru fiecare tab e păstrat cu `chrome.storage.session` și se șterge când închizi tabul sau browserul. Dacă memoria site-urilor e pornită (implicit, când certificatul e citit din browser), se păstrează tot cu `chrome.storage.local` numele fiecărui site verificat și autoritatea de certificare folosită (nume, amprente de chei, date și numărul de verificări), ca SSL Checker să te poată avertiza când un site apare brusc cu altă autoritate. Din ferestrele incognito nu se înregistrează nimic. Datele nu părăsesc dispozitivul; poți opri memoria sau o poți șterge din Opțiuni, iar site-urile nevăzute de 400 de zile se șterg automat.

**Terți.** Serverele notar pe care le adaugi sunt operate de tine sau de cine alegi tu; se aplică politicile lor. Folosirea datelor de către SSL Checker respectă Politica privind datele utilizatorilor din Chrome Web Store, inclusiv cerințele de utilizare limitată (Limited Use).

**Contact.** [adresa ta de e-mail de contact]
