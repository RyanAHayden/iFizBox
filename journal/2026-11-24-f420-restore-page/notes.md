# F420: Restore My VPN adds its Shortcut and remembers the VPN

## What I did
- `web/app/signing/restoresetup.js` (new): adds the Shortcut, then its store run (`setUpRestore`), reached by `import()`.
- `web/app/core/installroute.js`: the kept state (`ifizbox.restoreShortcut`), what is left (`restoreLeft`), the footers
  and the failure alerts (`restoreFooter`, `rememberFailed`).
- `web/app/screens/installroute.js`: the fix row, Remember VPN Again in its own group, the switch's on path, and
  `patchGroups` with `grow`.
- Tests: `web/app/signing/restoresetup.test.js`, `web/app/screens/installroute-f372.test.js`.
- `release-notes/F420.md`: one line.

## Decisions
- R100 says go.
- The new module `signing/restoresetup.js` is reached by `import()`, because the startup module cap
  (`module-graph.test.js`, 120) is full.
- Turning it on with the Shortcut already added stores again when a VPN is up, which covers a changed VPN app.
- Remember VPN Again is in its own group, so each group has one footer.
- "canceled" from a store run isn't taken as missing, since F419 saw it with Allow still up.
- `patchGroups` got `grow`, so the switch's row stays the same element and its knob slides when the fix row comes.
- An older shell without `remembered` shows only the switch.

## Checks
- `node --test`.
- Chromium (fake bridge, iOS 6 style, light): off, adding, on, VPN off, the alert; the knob row kept.

## Failed
- Nothing.

## Not verified
- On a phone: the share sheet, iOS's Allow prompt, a real store run from the page (F418b checked the bridge itself).
- Dark and the other eras in Chromium.
- A deleted Shortcut on a phone.
- Added by the share sheet but cancelled in Shortcuts with the VPN off: shown as added until a store run doesn't find it.
- Lost browser storage with the Shortcut still there: Add Shortcut is offered again if nothing is remembered.
