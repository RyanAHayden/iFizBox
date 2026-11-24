# F412: Restore My VPN switch

## What I did
- web/app/core/installroute.js: `RESTORE_VPN`, `restoreShown` (the built-in VPN and a boolean `vpn.restore`), `restoreFooter` (on and off footers), and `setupFooter` leaves out the other-VPN line while Restore My VPN is on.
- web/app/screens/installroute.js `localGroups`: a Restore My VPN group between Set Up and Forget Pairing; `dressRestore` adds the switch to the drawn row, `syncRestore` sets its knob after a repaint.
- Test in web/app/screens/installroute-f372.test.js.
- docs/settings.md, docs/sideload.md, release-notes/F412.md.

## Decisions
- The row is kept on a repaint (its state is not in the row's content), so the knob slides instead of jumping.
- A status read that began before a tap doesn't bring the old setting back.
- A failed `vpn.setRestore` reads the status again and shows that setting (no answer: the one before the tap), without an alert.
- The other-VPN line ("Turn it back on after.") is left out while Restore My VPN is on, since it contradicts the switch.
- Hidden on a shell without the setting.
- Icon reuses the blue arrows (`syncNow`); no new art.
- The glossary term already exists from F411.

## Chromium check
- F372's capture.mjs with a `vpn.setRestore` fake, at 402 and 320 pt: `shots/switch-402.jpg` and `shots/switch-320.jpg`, covering off, mid-slide, on, and off again after leaving the page and coming back (the setting held).
- No horizontal overflow.

## Not verified
- The real call on an iPhone: a web-only change. F411 checked `vpn.setRestore` on the 15 Pro.
- Eras other than iOS 6 in the shots.

## Spec review
Fixed: two quick taps that both fail, a call that fails late, and stale status reads elsewhere (the guard is in `rememberStatus`). The dropped other-VPN line is kept: it would contradict the switch.
