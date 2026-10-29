# Publishing to the Chrome Web Store

## What happened to the old listing

"SSL Checker" 0.3 was a Manifest V2 extension. Chrome 138 disabled MV2 extensions for good (July 2025), and on 31 August 2026 Google removed every remaining MV2 extension from the Chrome Web Store. The item **stays in the Developer Dashboard**, but it is no longer visible and receives no updates. Google's notice does not say whether uploading an MV3 package to the same item republishes it, so first try the route that keeps the ID (`nbanpljakngdndmmekhogfliinegiapb`) and the existing users.

## Steps

0. **Deploy the PlusPrivacy notary first** ([`notary/README.md`](../notary/README.md)): the extension asks it by default. `https://notary.plusprivacy.com/v1/health` must answer before you publish. In the notary's `.env`, `ALLOWED_ORIGINS` must contain the item's ID: `chrome-extension://nbanpljakngdndmmekhogfliinegiapb` for the old item; if step 3 ends up creating a new item, put its ID there and run `docker compose up -d`.
1. **Build the packages:** `node scripts/build.mjs`, or double-click `build\package.cmd` on Windows. You get `dist/ssl-checker-<version>.zip` (full) and `dist/ssl-checker-lite-<version>.zip`, where `<version>` is the one in `extension/manifest.json`.
2. **Test the zip locally:** unzip it, open `chrome://extensions` → _Developer mode_ → _Load unpacked_ and select the unzipped folder. Open an HTTPS site and click the icon.
3. **Dashboard → the old "SSL Checker" item → Package → Upload new package** → `ssl-checker-<version>.zip`.
   If the dashboard refuses it (removed item), create a **new item** with the same zip. It gets a new ID, and existing users have to install it again.
4. **Store listing:** copy the texts from `store/listing.md` and add the **Romanian** localization. For each language, upload the screenshots from `store/screenshots/<language>/1-…4-*.png` and the `promo-440x280.png` tile. Category: _Developer Tools_.
5. **Privacy practices:** fill them in from `store/permissions.md` (single purpose, justifications for `debugger`, `activeTab` and `storage`, "no remote code", data usage).
6. **Privacy policy:** add your contact address to `store/privacy-policy.html`, host the page (on GitHub Pages, for example) and put its URL in the dashboard.
7. **Test instructions:** use the text from `store/permissions.md`. The reviewer needs no notary address or token: the PlusPrivacy notary answers by default.
8. **Submit for review.** The `debugger` permission gets a more thorough review; the detailed justification from step 5 helps.

## The lite variant (optional)

`ssl-checker-lite-<version>.zip` does not have the `debugger` permission, so it does not show the strong warning at install time either. It is published as a **separate item** ("SSL Checker Lite") with the same materials, minus the `debugger` justification. It relies entirely on notaries, so it shows certificates as soon as the PlusPrivacy notary runs.

## On every update

- Increase `version` in `extension/manifest.json` (for example from `2.0.0` to `2.0.1`), since the store refuses an equal or lower version, and keep `package.json` on the same version.
- Run `npm test` and `npm run test:e2e`, then build the packages.
- If you change the UI, `node store/tools/make-screenshots.mjs` regenerates the screenshots from the real code.
