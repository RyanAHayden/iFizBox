# B307: the website's /add link lands on the Sources tab

## What changed

- `web/app/app.js`: a `/add?url=…` link replaces the address with `#/sources` (the Sources tab root, the same hash
  as incoming.js `SOURCES_ROOT`) instead of `#/sources/manage/sources`, and runs Add Source with
  `{ showHUD, fromLink: true }` instead of the app's whole ctx, so manage.js `addSource` sends the change notice with
  no ctx and sources.js loads the new source with the tab's own ctx (reload bar, badge), as B306's source links do.
  app.js uses router `format({ tab: "sources" })` rather than importing incoming.js, which app.js loads lazily.
- Test: `web/app/add-link-sources-tab.test.js` (source text of app.js's /add block: the Sources root, no Manage,
  `fromLink`; the hash equals `SOURCES_ROOT`).

## Checked

- Headless Chromium (a throwaway probe on smoke.mjs's setup, website mode, server answering `/add` with
  index.html): `/add?url=https://repo.example.com/` ends at `/#/sources`, the Sources tab button is the selected
  one, Enter Source URL's alert is over the Sources list with the URL filled in, no page errors.

## Not verified

- Tapping Add Source in Chromium and watching the new source load: the probe has no reachable source to add (no
  `/api/fetch` Worker), so no real add runs. The load path with `fromLink` is the one B306 tested in node
  (`incoming-sources-tab.test.js`).
- The live ifizbox.com: the change ships only with the next site deploy; the probe served `web/app` locally.
