# Privacy practices — texts for the Chrome Web Store form

Developer Dashboard → the item → **Privacy practices**. The quoted blocks are ready to paste into the form.

## Single purpose

> SSL Checker inspects the TLS certificate of the website in the active tab and verifies it against independent notary servers chosen by the user, to show whether the HTTPS connection is being intercepted.

## Permission justification

**debugger**

> Chrome provides no extension API to read the TLS certificate of a loaded page; the Chrome DevTools Protocol is the only way. When the user opens the popup (or clicks "Read from browser", depending on their setting), SSL Checker attaches chrome.debugger to the active tab for about one second and uses only these commands: Network.enable, Network.setBypassServiceWorker, Page.getFrameTree, Page.createIsolatedWorld with Runtime.evaluate to send one same-origin HEAD request for /favicon.ico without cookies (so Chrome reports the connection), Network.getCertificate to read the certificate chain, and Page.reload only after the user explicitly clicks "Reload page and read" on pages whose Content Security Policy blocks that request. It then detaches immediately. It never reads page content, cookies, form data or other tabs, and never runs in the background on its own. Users can switch reading to "On demand" or "Never" in Options.

**activeTab**

> Gives the popup the URL of the active tab after the user clicks the toolbar icon, so SSL Checker knows which host to check. The extension requests no host permissions.

**storage**

> Stores the user's settings (reading mode, notary server addresses with their optional access tokens, timeout) in chrome.storage.local on the device, and the last result per tab in chrome.storage.session so that reopening the popup does not repeat the check.

## Remote code

> No, I am not using remote code. All JavaScript is included in the package. Notary servers return JSON data (certificates encoded in base64), which is parsed, never executed.

## Data usage

Tick **Web history** and write this in the justification:

> Only when the user checks a site, its host name and port are sent to the notary servers that the user has configured in Options (none by default). The developer does not receive or store any data.

Then tick the three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Why "Web history": Google counts any transfer of data off the device as collection. The name of the checked site reaches the notary servers the user picked, so the conservative declaration is the right one. If you ever operate a default notary yourself, keep the same box ticked, and the privacy policy must say what that server keeps (the reference implementation keeps nothing, and its log does not contain site names).

## Privacy policy URL

Host `store/privacy-policy.html` (on GitHub Pages, for example) and put its address in the **Privacy policy** field. Fill in the contact address in the page first.

## Test instructions (for the reviewer)

> 1. Open https://www.google.com and click the SSL Checker icon. Chrome shows the "SSL Checker started debugging this browser" bar for about one second while the certificate is read; the popup then shows "Publicly logged certificate" and the certificate details.
> 2. Options → External sources → add the notary below, then click the icon again: the popup shows "Confirmed by 1 external source".
>    Notary: <your notary URL>   Token: <your test token>
> 3. Options → Reading from your browser → Never: the popup no longer attaches the debugger and shows only the external result.
