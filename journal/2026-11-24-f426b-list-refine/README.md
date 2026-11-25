# F426b: refine() for Browse's lists

Done: `refine(rows, { section, source, installed, price, sort })` in `web/app/core/catalog.js`, with worker op
`refine` and `catalog.refine` in `web/app/catalog.js`. search()'s section, installed and price checks now go through
one shared `filterTest`.

- Rows come back as given, so New's change and seen flags are kept.
- Source keeps what that source lists: its other Source Filters, hidden sections and misfits count, as in Search.
  Newest Copy Only does not (Search's source pool does apply it): it is on by default and would take out every
  package whose row shown is another source's. The review caught the first version, which used the source's own list.
- Section and price test the row shown, what the person sees on it; Search with a source draws and tests that
  source's copy.
- Sort newest uses popular()'s date (the AltStore version date; tweaks have none and go last), ties by name.
  Sort popular uses sourceCounts and rankPopular (ties newest, then name). An unknown sort keeps the order.
- Sideload build: App Tweaks and group:Tweaks keep the rows from Tweak Sources.

Tests: `web/app/core/catalog-refine.test.js`. They cover `core/catalog.js`; the one-line `catalog.refine` in `web/app/catalog.js` has none.

**Not verified**: on-device speed of sending a long list to the worker and back. No UI calls it yet; F426c checks
scrolling a long list. No release note (F426c has the UI).
