# Publicarea în Chrome Web Store

## Ce s-a întâmplat cu listarea veche

„SSL Checker” v0.3 era Manifest V2. Chrome 138 a dezactivat definitiv extensiile MV2 (iulie 2025), iar pe 31 august 2026 Google a scos toate extensiile MV2 rămase din Chrome Web Store. Itemul **rămâne în Developer Dashboard**, dar nu mai e vizibil și nu mai primește actualizări. Anunțul Google nu spune explicit dacă un pachet MV3 urcat pe același item îl republică, așa că încearcă întâi varianta care păstrează ID-ul (`nbanpljakngdndmmekhogfliinegiapb`) și utilizatorii.

## Pași

1. **Construiește pachetele:** `node scripts/build.mjs` → `dist/ssl-checker-1.0.0.zip` (complet) și `dist/ssl-checker-lite-1.0.0.zip`.
2. **Testează local zip-ul:** dezarhivează-l, `chrome://extensions` → *Developer mode* → *Load unpacked* → folderul dezarhivat. Deschide un site HTTPS și apasă pe iconiță.
3. **Dashboard → itemul vechi „SSL Checker” → Package → Upload new package** → `ssl-checker-1.0.0.zip`.
   Dacă dashboard-ul refuză (item eliminat), creează un **item nou** cu același zip; vei primi un ID nou, iar utilizatorii vechi trebuie să o instaleze din nou.
4. **Store listing:** copiază textele din `store/listing.md`; adaugă localizarea **Română**; încarcă pentru fiecare limbă capturile din `store/screenshots/<limbă>/1-…4-*.png` și tile-ul `promo-440x280.png`. Categoria: *Developer Tools*.
5. **Privacy practices:** completează din `store/permissions.md` (scop unic, justificarea pentru `debugger`, `activeTab`, `storage`, „no remote code”, declarația de date).
6. **Politica de confidențialitate:** completează adresa de contact în `store/privacy-policy.html`, găzduiește pagina (de exemplu GitHub Pages) și pune URL-ul în dashboard.
7. **Test instructions:** textul din `store/permissions.md`, cu adresa și tokenul unui notar de test, ca reviewerul să poată vedea și comparația externă.
8. **Trimite la review.** Permisiunea `debugger` aduce un review mai amănunțit; justificarea detaliată din pasul 5 ajută.

## Varianta Lite (opțional)

`ssl-checker-lite-1.0.0.zip` nu are permisiunea `debugger`, deci nici avertismentul dur la instalare. Se publică drept **item separat** („SSL Checker Lite”), cu aceleași materiale, fără justificarea pentru `debugger`. Fără cel puțin un notar configurat nu poate afișa nimic, așa că merită publicată abia când ai un notar public pe care îl poți recomanda în descriere.

## La fiecare actualizare

- Crește `version` în `extension/manifest.json` (de exemplu `1.0.1`); Store-ul refuză o versiune egală sau mai mică.
- `npm test` și `npm run test:e2e`, apoi `node scripts/build.mjs`.
- Dacă schimbi interfața: `node store/tools/make-screenshots.mjs` regenerează capturile din codul real.
