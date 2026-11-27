# Manish Expense & Income Manager · v1.0.0

A private, installable web app for MacBook (Safari) and iPhone (Safari). It has 6 expense tabs, an Income tab with 5 source buttons, voice entry, multi-currency entries (CAD, USD, INR, GBP, EUR) with CAD reporting, receipts with optional on-device reading, and CSV export/restore. It costs ₹0: no paid APIs, no billing, no card.

The full setup, user guide and install steps are in the doc "Manish Expense Manager: Setup & User Guide".

## Status
| Area | Status |
|---|---|
| Voice phrase parsing, currency detection, receipt-text parsing | ✅ 22 automated tests (`node tests/parser.test.js`) |
| Screens at iPhone and Mac sizes, demo storage, rates, rate outage, CSV, restore, sign-in redirect | ✅ 30 automated browser checks (`tests/ui.test.py`), using simulated speech and rates |
| Real voice in Safari (Mac + iPhone) | ❌ Not tested yet |
| Live Google Sheet/Drive, live rates service, receipt reader (beta) | ❌ Not tested yet |

It is **not production-ready** until the ❌ rows pass on Manish's real devices.

## Files
`index.html` `styles.css` `app.js` `parser.js` `rates.js` `store.js` `config.js` `sw.js` `manifest.webmanifest` `icon-192.png` `icon-512.png` `icon-maskable-512.png` `apple-touch-icon.png` `README.md` (14 files to upload; leave out `tests/`).

## Architecture
```
Safari (Mac / iPhone)  ──  aruneshchandmankotia.github.io/manish  (static files only, no server)
  app.js  UI, drafts, CAD reports       parser.js  speech → draft (never guesses currency silently)
  rates.js  Frankfurter reference rates (free, no key), saved per entry
  store.js  Demo (IndexedDB)  |  Google (Manish's own Sheet + Drive folder, drive.file scope)
  Sign-in: full-page Google redirect (no pop-ups, works in Safari web apps)
  Receipt reader (beta): Tesseract.js, downloaded on first use, runs on the device
```

## Permissions
- **Microphone / speech recognition:** tap-to-talk only, no audio is stored.
- **Google `drive.file`:** only the files the app creates. No full-Drive, Gmail or Contacts access.
- **Nothing else.**

## Data model (Google Sheet tabs)
- **Expenses:** `id, tabId, tabName, date, currency, amount, amountMinor, rateToCAD, rateDate, rateSource, amountCAD, cadMinor, description, receiptId, receiptName, receiptLink, receiptHash, entryMethod, createdAt, updatedAt`
- **Income:** the same money fields, plus `sourceId, sourceName, payer, service, notes`.
- **Audit:** every create, update, delete and restore, with before/after values.
- **Settings.**

## Rules
- **Rates.** Each entry uses the reference rate for its own date, stored with the entry. The rate changes only if the entry's currency or date is edited. If the rate service is down, the entry is saved as "rate pending" and excluded from CAD totals (marked *) until "Get rates now".
- **Currency.** Spoken "dollars" or "$" alone is never guessed: the draft asks for USD or CAD. When no currency is said at all, the tab's usual currency is preselected and flagged.
- **Saves.** Saves are idempotent (one ID per draft) and read back before "Saved ✓". Writes use RAW mode, and CSV export escapes leading `= + - @`.
- **Receipts.** PDF/JPG/PNG/WEBP, max 10 MB. Duplicate files are detected by SHA-256. Deleting an entry moves its file to the Drive bin.
- **Dates.** Dates follow the device's local date (Manish's Canadian time).

## Limits to disclose
- **Receipt reader (beta).** Photos only (not PDFs). The first use downloads about 10–15 MB. Accuracy varies, so every field must be checked.
- **iPhone Home Screen app.** Safari speech recognition there may not work. The "Type or dictate instead" box (keyboard 🎤) is the fallback, or open the app in Safari.
- **Google sign-in.** The sign-in lasts about an hour; after that, the app shows "Sign in with Google" again.
