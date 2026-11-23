# B373: Installed section's Mark as Not Installed row forgets only the installed record

On the app page, the Installed section's Mark as Not Installed row removed only the installed record and left
iFizBox's signed record. That record brought the app back (`restoreSourceRecords`), and the nav button stayed on Modify.

## Cause

- `web/app/screens/altstore.js` `trackingSection`: the row's click ran the forget directly, not through the held
  forget from B372, so the signed record survived and was restored.

## What changed

- `web/app/screens/altstore.js`: new exported `sectionMarkNotInstalled(app, pkg, source, {store, signedOf, native,
  forget, body, warn})`. It calls `toggleMarked` with the page body, so both records are forgotten when the page is
  left (the held forget from B372).
  - Mark as Installed before then (the section row's remark, or the nav toggle) cancels the hold, and the signature's
    expiry is kept.
  - A forget already held is left alone, so nothing is re-marked by accident.
  - With no page body, both records go at once. A forget that fails at once shows the alert.
- The row's `onClick` in `trackingSection` now calls `sectionMarkNotInstalled` and redraws.
- `web/app/screens/altstore.test.js`: 3 node tests added:
  - held, then cancelled: the signed record and expiry are kept;
  - held, then the page is left: both records are forgotten;
  - no page body: both are forgotten at once, and a failure shows the warning.

## Check

`node --test web/app/screens/altstore.test.js`: 17 pass.

## Not verified

- The row was not tapped in a real browser or on a phone. `trackingSection` needs a DOM, and the node tests cover the
  action function, not the click wiring.
- No real-device check. The change is web-only logic on the B372 hold mechanism.
