# B338: the app page's mark toggle forgets the signature too

## What was wrong
The nav bar's checkmark toggle (`markToggle`, `web/app/screens/altstore.js`) only called `removeInstall`. For an app
iFizBox signed, the signing.installed record stayed, Installed's `restoreSourceRecords` wrote the installed record
back from it, and the nav button kept reading Modify. The toggle's on/off read only the installed record, so a
signed-only app showed an outline check.

## What changed
- `toggleMarked` reads the installed record and the signature (`signedRecordOf`); when either stands, it calls
  Installed's Remove from List (`installed.js forgetApp`: `signing.forget` for the signature, `removeInstall` for the
  record). `forgetApp` is loaded with a dynamic import because `installed.js` already imports `altstore.js` (via
  `browse.js`); a static import would make a cycle.
- `markToggle.refresh` counts a signature as marked.
- `markToggle` takes `after()`; `renderApp` passes the Installed section's `redraw`, so the section and the nav label
  follow at once even for a signed-only app (where no `removeInstall` fires `onAppsChange`).
- `trackingSection` is exported, takes `store` / `signedOf` for tests, and exposes `redraw` and `drawn`.
- The Modify sheet's Mark as Not Installed is untouched, as asked.
- The nav label itself still counts only the installed record (not the signature): the brief asked only the toggle to
  count a signature, and a signed app a source offers gets its record back anyway.

## Tests
`web/app/screens/altstore-marktoggle.test.js`: a signed + remembered app's tap calls `signing.forget` and
`removeInstall`, the nav button reads Install right after, the toggle goes outline and the section is back to Mark as
Installed; a signed-only app reads filled and its tap forgets the signature without marking it.
`node --test` over altstore*, marknotinstalled and installed* screen tests: 123 pass.

## Not verified
- On a phone (the 15 Pro in the sideload build): not tried; the change is web-only and covered by the fake-DOM test,
  and the 15 Pro was not on USB for the last task (B327).
