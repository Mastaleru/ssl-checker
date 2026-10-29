// The notary the extension asks by default, run by PlusPrivacy (see notary/).
// It is not stored with the user's own sources, so a later version can move it;
// Options turns it off, and nothing is sent to it before the user agrees in the popup.

export const DEFAULT_NOTARY = Object.freeze({
  id: 'plusprivacy',
  name: 'PlusPrivacy',
  url: 'https://notary.plusprivacy.com/v1/cert',
});

export const DEFAULT_NOTARY_HOST = new URL(DEFAULT_NOTARY.url).host;
