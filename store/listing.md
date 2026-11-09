# Chrome Web Store listing

What goes into Developer Dashboard → **Store listing**. English is the default language (`default_locale: en`); every other language of the extension is a localization of the listing. The name and the summary come from each language's `extension/_locales/<language>/messages.json` (`extName`, `extDescription`) automatically.

- **Category:** Developer Tools
- **Default language:** English
- **Description:** the whole text of `store/listing/<language>.txt`, pasted as it is. At most 2,000 characters; the tests check every file, counting each line break twice, as the dashboard does.
- **Screenshots:** `store/screenshots/<language>/1-…4-*.png` (1280×800). The English ones are the global **Screenshots**; each other language's go in its **Localized screenshots**. The store shows a localized listing's own screenshots first, then the global ones.
- **Small promo tile:** `store/screenshots/en/promo-440x280.png`, for every language: the store does not localize promo tiles.
- **Icon:** `extension/icons/ssl128.png`
- **Homepage URL:** `https://sslchecker.plusprivacy.com/`

To fill in a localization, pick the language at the top of **Store listing**, paste its description and upload its screenshots. The dashboard offers only the languages of the uploaded package, so a new language appears there once a package with its `_locales` folder is uploaded.

| Language             | Folder  | Description               | Screenshots                |
| -------------------- | ------- | ------------------------- | -------------------------- |
| English (default)    | `en`    | `store/listing/en.txt`    | `store/screenshots/en/`    |
| Romanian             | `ro`    | `store/listing/ro.txt`    | `store/screenshots/ro/`    |
| German               | `de`    | `store/listing/de.txt`    | `store/screenshots/de/`    |
| Spanish              | `es`    | `store/listing/es.txt`    | `store/screenshots/es/`    |
| French               | `fr`    | `store/listing/fr.txt`    | `store/screenshots/fr/`    |
| Italian              | `it`    | `store/listing/it.txt`    | `store/screenshots/it/`    |
| Dutch                | `nl`    | `store/listing/nl.txt`    | `store/screenshots/nl/`    |
| Polish               | `pl`    | `store/listing/pl.txt`    | `store/screenshots/pl/`    |
| Portuguese (Brazil)  | `pt_BR` | `store/listing/pt_BR.txt` | `store/screenshots/pt_BR/` |
| Turkish              | `tr`    | `store/listing/tr.txt`    | `store/screenshots/tr/`    |
| Ukrainian            | `uk`    | `store/listing/uk.txt`    | `store/screenshots/uk/`    |
| Japanese             | `ja`    | `store/listing/ja.txt`    | `store/screenshots/ja/`    |
| Korean               | `ko`    | `store/listing/ko.txt`    | `store/screenshots/ko/`    |
| Chinese (Simplified) | `zh_CN` | `store/listing/zh_CN.txt` | `store/screenshots/zh_CN/` |

The texts on the screenshots are in `store/tools/captions/<language>.json`; `node store/tools/make-screenshots.mjs` renders them again (`LANGS=de,fr` for some languages only).

## Lite variant (optional, separate item)

If you also publish `ssl-checker-lite-<version>.zip`, its name comes from `extNameLite` ("SSL Checker Lite") and its summary from `extDescriptionLite`. Use the same descriptions without the section on when the debugger runs ("YOU DECIDE WHEN THE DEBUGGER RUNS", the fourth heading), and state that this variant reads certificates only through notary servers: the PlusPrivacy notary by default, and any you add.
