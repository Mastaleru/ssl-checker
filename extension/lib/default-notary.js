// The notary the extension asks by default, run by PlusPrivacy (see notary/).
// It is not stored with the user's own sources, so a later version can move it;
// Options turns it off, and nothing is sent to it before the user agrees in the popup.
//
// Its answers count only when they are signed with one of these keys. Put here the
// key the deployed notary prints when it starts (notary/README.md); during a key
// change, list the old and the new one. With no key, the notary is not asked at all.

export const DEFAULT_NOTARY = Object.freeze({
  id: 'plusprivacy',
  name: 'PlusPrivacy',
  url: 'https://notary.plusprivacy.com/v1/cert',
  keys: Object.freeze(['ed25519:dE6Tyexy2N1NbVBgdhAQQCaFRKHqVE9WzeQMQOvUeaE']),
  requireSignature: true,
});

export const DEFAULT_NOTARY_HOST = new URL(DEFAULT_NOTARY.url).host;

// The site that the Test button in Options asks a notary about.
export const NOTARY_TEST_SITE = Object.freeze({ host: 'example.com', port: 443 });
