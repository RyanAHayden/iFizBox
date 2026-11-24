# B417: Installed opens the full Details page

## Cause
Installed's row linked to `#installed/app:<id>`, a plain page, whenever the candidates lacked the app. That included the time before sources had loaded, so a tap mid-load got the plain page.

## Fix
- Rows always link to `package:<id>`, with `@<source key>` of the candidate when there is one, else the record.
- `renderInstalledApp` (installed.js) draws the source's page from what the worker has now (`catalog.peekPackage`, no wait). If there is none, after 150 ms it draws the record in the same layout (`renderRecordApp`, `recordSections` in altstore.js), then redraws with the final answer (`findApp`: named source, else any). It redraws only when the page differs.
- Pages drawn from a record look again on `catalog.onLoaded` and `onAppsChange`.
- `reloadSigned`: record pages redraw; source pages refresh their Installed section and toggle (`renderApp`'s refresh).
- Old `app:<id>` links open the same page.
- Removed: `renderAppPage`, `appPageSections`, `appToken`, `appIdOf`, `appNames`.

## Decisions
- A signed app with no record (URL, My IPAs) always gets the record layout, never a source that shares its ID.
- The record page makes no App Store lookup.
- While loading, record actions sit in the nav bar's Modify (the hold sheet); once settled they are rows.

## Checked
- `node --test`, including the new `installed-app.test.js`.
- Chromium with the fake bridge, sideload mode, test source delayed 9 s: tap mid-load, filled in, tap after, source removed, My IPAs signed only, its Modify sheet, old `app:` link. Shots in `pages.png` here.
- First capture run cleared the wrong IndexedDB and timed out; the run now clears through `core/cache.js`.

## Not verified
- Not on a phone (the task says none needed).
- The jailbreak app's Apps page and the website only by unit tests, not drawn in Chromium.

Review: a quiet reload during the first draw of an app with no row left the placeholder; fixed. A signed-only page says
"Signed by <name>, not from a source." (no source was asked). When a record page fills in from its source, the
selected tab goes back to Details. The drawn pages themselves (renderRecordApp, renderApp's refresh) have no unit test:
the record page was checked in Chromium, the refresh on reloadSigned was not (Not verified).
