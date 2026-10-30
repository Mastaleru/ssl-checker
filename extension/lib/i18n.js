// Thin wrapper over chrome.i18n with plural support and dates in the UI language.
// Localising static markup (localizeDocument) lives in ui/dom.js, with the DOM code.

export function t(key, substitutions) {
  const subs = substitutions === undefined ? undefined : [].concat(substitutions).map(String);
  return chrome.i18n.getMessage(key, subs) || key;
}

// Dates and plurals must follow the language of the messages Chrome picked.
// Each messages.json carries its own BCP 47 tag ("localeCode") because
// getUILanguage() and @@ui_locale can disagree with the chosen messages.
export const uiLanguage = () => chrome.i18n.getMessage('localeCode') || chrome.i18n.getUILanguage();

const pluralRules = new Intl.PluralRules(uiLanguage());

/** Picks <base>One / <base>Few / <base>Other by the UI language's plural rules. */
export function plural(base, count) {
  const category = pluralRules.select(count);
  const key = category === 'one' ? `${base}One` : category === 'few' ? `${base}Few` : `${base}Other`;
  return t(key, [count]);
}

const dateFormat = new Intl.DateTimeFormat(uiLanguage(), { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(uiLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
const relativeFormat = new Intl.RelativeTimeFormat(uiLanguage(), { numeric: 'auto' });

export const formatDate = (iso) => dateFormat.format(new Date(iso));
export const formatDateTime = (iso) => dateTimeFormat.format(new Date(iso));

export function formatRelative(iso, now = Date.now()) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) {
    return relativeFormat.format(seconds, 'second');
  }
  if (abs < 3600) {
    return relativeFormat.format(Math.round(seconds / 60), 'minute');
  }
  if (abs < 86400) {
    return relativeFormat.format(Math.round(seconds / 3600), 'hour');
  }
  return relativeFormat.format(Math.round(seconds / 86400), 'day');
}
