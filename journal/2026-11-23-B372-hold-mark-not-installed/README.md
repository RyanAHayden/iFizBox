# B372: Mark as Not Installed then Mark as Installed loses the signature

On the app page, Mark as Not Installed ran `signing.forget` at once. Marking it installed again then wrote a bare
record with no signed record and no signature expiry, so the app looked installed but had nothing to renew.

## Cause

- `web/app/screens/altstore.js`: the app page's Mark as Not Installed called `signing.forget` as soon as it was
  tapped. Marking installed again afterwards had only the bare record to write back.

## What changed

- `web/app/screens/altstore.js`: a "held forget" per bundle ID, with `holdForget`, `cancelHeldForget`,
  `flushHeldForgets`, `forgetHeld` and `onHeldForget`.
  - On the app page, two paths hold the forget instead of running it: the nav bar toggle (`markToggle` /
    `toggleMarked`, with `body`) and Modify's Mark as Not Installed (`appPageAction`, which finds the page through
    the body `renderApp` registers). The page (toggle, Installed section, nav label, Modify) reads Not Installed at once.
  - The held forget runs when the page's body leaves the document (a MutationObserver on `documentElement`; the
    app removes popped pages at idle), or on `pagehide` and `visibilitychange` to hidden (app or tab goes away).
  - Marking installed again before then (the toggle, or the section's Mark as Installed row) cancels the hold, so
    the records and the expiry stay.
  - Installing the app again while the forget is held (Install from the nav button or Version History, or the
    website's Install) cancels the hold first, so leaving the page does not forget the new install.
  - Away from the page (no body), behaviour is unchanged.
- The Installed section's Mark as Not Installed row is unchanged: it removes only the installed record and keeps the
  signed record, so it never lost the expiry (not this bug). A first try routed it through the held toggle path; the
  spec review flagged that as not asked (it would start dropping the signature), so it was reverted and filed as B373, a
  follow-up (the row leaves the signature, which B338 notes brings the record back).
- `web/app/screens/altstore.test.js`: 6 node tests appended:
  - toggle off then on: `signing.forget` never called, expiry kept;
  - toggle off then leave: forget runs once;
  - app hidden flushes the held forget;
  - a failing held forget shows an alert;
  - Modify held, then Install cancels the hold;
  - Modify off the page forgets at once.

The website's Modify sheet (`siteModify`) still forgets at once. It has no signed record, so the expiry problem
does not apply there. Other screens (Installed tab, Changes) still list the app until the page is left.

## Check

`node --test` on `altstore-marktoggle` and `marknotinstalled` tests: 33 pass.

## Not verified

- The `trackingSection` Mark as Installed row cancelling a held forget, and the MutationObserver / `pagehide` trigger have no node test. They need a DOM
  page stack. Not tried in Chromium or on a phone.
- Installed tab and Changes still listing the app during the hold: not checked visually.
