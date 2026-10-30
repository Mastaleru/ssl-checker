# Publishing to the Chrome Web Store

## What happened to the old listing

"SSL Checker" 0.3 was a Manifest V2 extension. Chrome 138 disabled MV2 extensions for good (July 2025), and on 31 August 2026 Google removed every remaining MV2 extension from the Chrome Web Store. The item **stays in the Developer Dashboard**, but it is no longer visible and receives no updates. Google's notice does not say whether uploading an MV3 package to the same item republishes it, so first try the route that keeps the ID (`nbanpljakngdndmmekhogfliinegiapb`) and the existing users.

## Steps

0. **Deploy the PlusPrivacy notary first** ([`notary/README.md`](../notary/README.md)): the extension asks it by default. `https://notary.plusprivacy.com/v1/health` must answer before you publish. In the notary's `.env`, `ALLOWED_ORIGINS` must contain the item's ID: `chrome-extension://nbanpljakngdndmmekhogfliinegiapb` for the old item; if step 3 ends up creating a new item, put its ID there and run `sudo docker compose up -d`. Then copy the notary's public key into `extension/lib/default-notary.js` (`keys`), as step 9 of its README shows, and commit it: without the key, the extension never asks the notary.
1. **Get the packages:** download them from the GitHub Release of the version tag, built after every test passed (README, Releases); or build them yourself with `node scripts/build.mjs`, or by double-clicking `build\package.cmd` on Windows. Either way there are two packages, `ssl-checker-<version>.zip` (full) and `ssl-checker-lite-<version>.zip`, where `<version>` is the one in `extension/manifest.json`. If the build warns that `default-notary.js` holds no key, go back to step 0; the release workflow refuses to run without it.
2. **Test the zip locally:** unzip it, open `chrome://extensions` → _Developer mode_ → _Load unpacked_ and select the unzipped folder. Open an HTTPS site and click the icon: the PlusPrivacy row must say "signed answer". The unpacked copy has another ID, so add it to `ALLOWED_ORIGINS` while you test.
3. **Dashboard → the old "SSL Checker" item → Package → Upload new package** → `ssl-checker-<version>.zip`.
   If the dashboard refuses it (removed item), create a **new item** with the same zip. It gets a new ID, and existing users have to install it again.
4. **Store listing:** copy the texts from `store/listing.md` and add the **Romanian** localization. For each language, upload the screenshots from `store/screenshots/<language>/1-…4-*.png` and the `promo-440x280.png` tile. Category: _Developer Tools_.
5. **Privacy practices:** fill them in from `store/permissions.md` (single purpose, justifications for `debugger`, `activeTab` and `storage`, "no remote code", data usage).
6. **Privacy policy:** put `https://sslchecker.plusprivacy.com/privacy/` in the dashboard. The page lives in the [ssl-checker-website](https://github.com/Mastaleru/ssl-checker-website) repository, which GitHub Pages publishes; its README has the one-time setup.
7. **Test instructions:** use the text from `store/permissions.md`. The reviewer needs no notary address or token: the PlusPrivacy notary answers by default.
8. **Submit for review.** The `debugger` permission gets a more thorough review; the detailed justification from step 5 helps.

## The lite variant (optional)

`ssl-checker-lite-<version>.zip` does not have the `debugger` permission, so it does not show the strong warning at install time either. It is published as a **separate item** ("SSL Checker Lite") with the same materials, minus the `debugger` justification. It relies entirely on notaries, so it shows certificates as soon as the PlusPrivacy notary runs.

## On every update

- Raise the version with `npm run bump-version <version>` (for example `npm run bump-version 2.0.2`): it sets `extension/manifest.json`, `package.json` and `package-lock.json`, and refuses a version that is not higher, since the store refuses an equal or lower one.
- Commit and push, then, once CI is green, push the tag `v<version>`: the release workflow runs every test and publishes the packages as a GitHub Release. Upload `ssl-checker-<version>.zip` from there.
- If you change the UI, `node store/tools/make-screenshots.mjs` regenerates the screenshots from the real code.
- If the update changes what the extension or the notary does with data (a permission, something new that is sent, stored or kept), update the privacy policy in ssl-checker-website, with its date, before you submit.
