# B395: Shortcuts opened again and again on an update

## Summary

On This iPhone, an update or a check could send the phone back and forth between iFizBox and Shortcuts. The cause on
the iPhone 15 Pro (iOS 27.0.1, Wi-Fi, main before this change) was the Install Switch's check: when Shortcuts couldn't
run the Shortcut by name, `vpn.checkShortcut` (Add or Update on the Install Switch page) opened Shortcuts 5 times in
15 s, ending in "Could not find the shortcut". Deleting and adding the Shortcut again stopped it. The fix caps every
Shortcuts open per queue of installs, holds a queue through an install's reconnects, says what stayed off, and
stops an install on cellular when the Install Switch didn't run.

This fits the user's words, but their own phone log wasn't seen, so it isn't proven to be what they hit.

## What was built

- `native/sign/SwitchOpens.swift`: the rules, pure Swift, tested on Linux by `native/sign/tests/sideload/main.swift`.
  A queue takes one trip and an end, or an older Install Switch's start, dataOff and end, each once. After a failed
  run only the end. A failed start or trip rests new queues' starts for 5 minutes (the next app of a run is often a
  queue of its own), ended by a passed check or a tapped Test Install Switch. A check runs at most twice.
- `native/sideload/vpn/App/LocalVPN.swift`: keeps one `SwitchOpens` under its lock. `installBegan` and `installEnded`
  (called from `IDevice.install`) keep a queue through reconnects and the pauses between them (up to 15 s), which
  were longer than the 3 s linger, so each reconnect used to start a new queue. A start that fails on cellular throws
  `switch_failed` before this VPN takes another's place; on Wi-Fi the install goes on. `vpn.leftOff` answers
  `{vpn, cellular}`, kept in `ifizbox.vpn.lost` across a kill. `vpn.checkShortcut` runs the check through
  `LocalVPN.checkShortcut`; no end is opened after "could not find the shortcut".
- `native/sideload/idevice/IDevice.swift`: `switch_failed` skips the other ways in (LocalDevVPN, Tailscale).
- `web/app/screens/installroute.js`: one check at a time (a second Add or Update starts nothing), the check forgives
  the route failure when it passes, and the automatic check sends `idevice.verify {quiet:true}`.
- `web/app/core/installroute.js`, `web/app/signing/route.js`, `web/app/screens/apprun.js`: `switch_failed` as one alert
  with Cancel, Update and Use Server (once per run).
- `web/app/incoming.js` (`watchLeftOff`, started from `web/app/app.js` on the sideload build): the "stayed off" alert.
- `docs/sideload.md` (Built-in VPN) and `release-notes/B395.md`.

## Design choices

- The cap is per queue, not global: a queue is what one user action starts, and the next app of a run is often its
  own queue, so the 5-minute rest carries across queues.
- Shortcuts' own callback is not trusted for a missing Shortcut: "could not find the shortcut" means no end either.
- The end runs once. A second end would open Shortcuts for the same thing; a run that never opened Shortcuts stays
  pending for the next launch.
- A check that isn't found waits 5 s and runs again (Add Shortcut's Replace takes a few seconds to show). A refused
  check with our actions runs the plain check at once.

## Opens counted from the syslog

Counted from SpringBoard's "user action request ... com.apple.shortcuts" lines.

- OLD (F386's Install Switch, the base build's check): 1 open.
- Old Install Switch (F386's, 636a09ee) on the base build: start and end, 2 opens per install, no loop.
- Base build, check with Shortcuts unable to find it (Add/Update): 5 opens in 15 s (16:26:20 to 16:26:35), ending in
  "Could not find the shortcut". This is the loop.
- Fixed build, MISSING Shortcut, older flags:
  - app update (signing.resign of Probe) with Tailscale: 1 open, alert "Your VPN Is Off".
  - app update without Tailscale: 0 opens.
  - check: 2 opens (was 5).
- Fixed build, MISSING Shortcut, trip flag: own update 1 open, alert after the relaunch.
- Fixed build, CURRENT Shortcut:
  - check: 1 open.
  - app update with Tailscale: 1 open.
  - app update without Tailscale: 0 opens.
  - Test Install Switch: 1 open.
  - own update: 1 open, plus 1 at the relaunch (end). VPN back; the end's callback was a stale "Wait for Install
    ... quit unexpectedly".
- Fixed build, DUPLICATED Shortcut (Keep Both makes "Install Switch 2"): check 1 open, app update 1 open.
- Replace here did not leave a duplicate.

## Causes found from the code (not all reproduced)

- Reconnect pauses (2, 4, 8, 15 s) are longer than the 3 s linger: each reconnect made a new start and end.
- With a missing Shortcut, each install opened Shortcuts twice (trip or start, then end), with nothing to gain.
- A trip ignored by an older Install Switch fell through to a start.
- The page's automatic check raced with a manual one.
- A redraw on return let Update be tapped again while a check was running.

## Found on the phone and fixed

- A killed app (own update) forgot that the VPN was lost, so nothing was said. Now kept in `ifizbox.vpn.lost` and said
  at the next launch.

## Tried and failed

- The first "missing" run was invalid: the wrong tile was tapped and Cellular Data Off was deleted. It was added back
  through the share sheet.
- An own update re-signs with the app's imported wildcard profile without Network Extensions, so the built-in VPN is
  gone until `ui-15.sh install` is run again. Some runs went through Tailscale and counted 0; those were discarded.
- After an own update while installd still holds the app, go-ios install fails with IXErrorDomain 48. A phone restart
  clears it.
- zsign "Unzip failed" in `/tmp`; signed with `-t` into the scratchpad instead.
- The CDP port for the page was 9395.

## Not verified

- Cellular (no SIM): the switch_failed alert and the stop on the phone, and dataOff.
- A real drop with reconnects: only the native test of the rule and the source checks ran.
- Two Shortcuts with exactly the same name (Replace's duplicate): could not be made. Shortcuts then answers as missing.
- The run page's and a single install's switch_failed alert on a phone: node tests only.
- The Update row tapped in the UI on the phone: a bridge call was used instead.
- The user's own phone; the page's quiet check on the phone.
- iOS 15 to 26.
- A localised "could not find" text: then the end is tried once too.
- A first app whose App ID isn't recorded is asked for while signing. That is a queue of its own, with one more
  capped run.

## Phone state

- The iPhone 15 Pro has this branch's build, the current Install Switch, both Cellular Data Shortcuts, and Tailscale
  connected.
