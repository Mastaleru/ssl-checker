# Privacy practices — texts for the Chrome Web Store form

Developer Dashboard → the item → **Privacy practices**. The quoted blocks are ready to paste into the form.

## Single purpose

> SSL Checker inspects the TLS certificate of the website in the active tab and verifies it against notary servers (the developer's PlusPrivacy notary by default, and any the user adds), to show whether the HTTPS connection is being intercepted.

## Permission justification

**debugger**

> Chrome provides no extension API to read the TLS certificate of a loaded page; the Chrome DevTools Protocol is the only way. When the user opens the popup (or clicks "Read from browser", depending on their setting), SSL Checker attaches chrome.debugger to the active tab for about one second and uses only these commands: Network.enable, Network.setBypassServiceWorker, Page.getFrameTree, Page.createIsolatedWorld with Runtime.evaluate to send one same-origin HEAD request for /favicon.ico without cookies (so Chrome reports the connection), Network.getCertificate to read the certificate chain, and Page.reload only after the user explicitly clicks "Reload page and read" on pages whose Content Security Policy blocks that request. It then detaches immediately. It never reads page content, cookies, form data or other tabs, and never runs in the background on its own. Users can switch reading to "On demand" or "Never" in Options.

**activeTab**

> Gives the popup the URL of the active tab after the user clicks the toolbar icon, so SSL Checker knows which host to check. The extension requests no host permissions.

**storage**

> Stores the user's agreement given in the popup and the user's settings (whether the PlusPrivacy notary is used, reading mode, notary server addresses with their optional access tokens and public keys, timeout) in chrome.storage.local on the device, and the last result per tab in chrome.storage.session so that reopening the popup does not repeat the check. For the site memory, which the user can turn off and wipe in Options, it also keeps in chrome.storage.local the host name of each site the user checked and the certificate authority it used (name, key fingerprints, dates, number of checks), so that it can warn when a known site suddenly presents a different authority. Nothing is recorded for tabs in incognito windows, and this data never leaves the device.

## Remote code

> No, I am not using remote code. All JavaScript is included in the package. Notary servers return JSON data (certificates encoded in base64), which is parsed, never executed.

## Data usage

Tick **Web history** and write this in the justification:

> Only when the user checks a site, and only after the user agreed in the extension's popup, the site's host name and port are sent to the PlusPrivacy notary, which the developer operates, and to any notary server the user adds in Options. The PlusPrivacy notary uses them only to connect to that site and return its certificate; it keeps no record of the sites, and the user can turn it off in Options.

To be conservative, also tick **Location**, with this justification:

> The PlusPrivacy notary sees the network (IP) address of each request, as every web server does. It keeps it in memory only to limit abuse (requests per minute, temporary blocks of at most 24 hours) and logs only the addresses it blocks.

Then tick the three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Why "Web history": Google counts any transfer of data off the device as collection, and the names of checked sites reach the developer's PlusPrivacy notary. The privacy policy says what that server keeps. Since 1 August 2026 the store also requires every data practice to be disclosed and agreed to inside the extension: the popup does that before the first check, and asks again whenever `CONSENT_VERSION` in `extension/lib/settings.js` is raised.

## Privacy policy URL

`https://sslchecker.plusprivacy.com/privacy/`, in the **Privacy policy** field. The page is published from the [ssl-checker-website](https://github.com/Mastaleru/ssl-checker-website) repository.

## Test instructions (for the reviewer)

Test instructions tab: leave the user name and password empty, and paste this into **Additional instructions**:

> No account or setup is needed: the PlusPrivacy notary (notary.plusprivacy.com) is live and answers this item.
>
> 1. Open https://www.google.com and click the SSL Checker icon. The popup first explains what it reads and sends; click "Agree and check".
> 2. Chrome shows the "started debugging this browser" bar for about a second while the certificate is read; this is expected. The popup then shows "Confirmed by 1 external source".
> 3. Options → "Reading from your browser" → "Never", then click the icon again: no debugger, and the popup shows "Seen by 1 external source". Set it back to "Every time".
> 4. Options → "External sources" → turn off PlusPrivacy, then click the icon again: nothing leaves the device, and the popup shows "Publicly logged certificate".
>
> Behind TLS inspection (a company proxy or an antivirus), the popup warns in red and names the inspecting authority: that is its purpose, not an error. Source code, including the notary: https://github.com/Mastaleru/ssl-checker
