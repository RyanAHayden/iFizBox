# B312: reinstall stuck while iOS installs the same app for another app

## What happened (user, 18 Pro, Lite, iOS 27)

After adding someone to the developer account SideDrop signs with, SideDrop re-signed and reinstalled every app.
Reinstalling uMod from iFizBox at the same time sat on the progress page. The user's correction: the .p12 still
worked (another app installed with it right after), so it wasn't a stale identity. Lead: iOS's installd was busy with
SideDrop's install of uMod.

## Why the page spun

`Sideload.watch` (signing.progress) asks `LSApplicationWorkspace installProgressForBundleID:` by bundle ID. With
another install of the same bundle ID running, that answers *that* install's progress from the first tick, so the
watch took it for ours (`seen = true`), showed its percent, and waited for it to end, up to 15 minutes; if it never
moved, nothing ended the watch before then. iOS never fetched our IPA meanwhile, so B200's {served} handoff never came
either.

## What changed

- `native/Sources/Sideload.swift` `watch`:
  - First tick: a progress for the bundle ID before iOS has fetched our IPA (the prompt has only just opened) means
    another install of it is running: `onBusy(true)` → `{busy: true}` to the page, and a console line. Its progress
    is not shown as ours.
  - When that install ends (progress gone), `{busy: false}` and the watch starts over for ours, with the whole `ask`.
  - Any progress (busy or ours) that sits still for `stuckQuiet` (60 s) before iOS has our whole IPA ends the watch:
    signing.progress fails `install_busy: …` (busy) or `install_stalled: …`. Raw `fractionCompleted` is compared, not
    whole percents, so a slow download still counts as moving. After iOS has the IPA the row is handed off anyway
    (B200), so the 60 s doesn't apply there.
  - Cancel: unchanged, the watch already ends on signing.cancel (all, or the row's tag).
- `web/app/signing/queue.js` `openPrepared`: `{busy}` events become the row's "busy" phase (back to "asking" on
  false); `install_busy` / `install_stalled` end the row Failed with our words. Every other watch failure still ends
  Sent to iOS (B146).
- `web/app/core/signing.js`: `busyText(app)` ("iOS is already installing uMod for another app. Wait for it to
  finish."), `busyStuckText(app)`, and `deviceError` for the two codes.
- `web/app/core/apprun.js`: the "busy" phase's log line, row status and run status say `busyText`.
- Tests: `web/app/core/signing.test.js` (the words), `web/app/install-busy.test.js` (row and run status while busy,
  back to waiting, Failed on both codes, other failures still Sent to iOS).

## Decided

- No identity check before signing: the brief keeps it only if cheap and not the cause; F236's device check
  (`device_not_in_profile`) and `no_identity` already cover a missing identity or device, and the user's .p12 worked.
- The This iPhone route (installHere, installation_proxy) isn't changed: it has no 15-minute wait, installd's step
  limit (IDevice.Limit.install, 180 s of no percentage) already ends it with an error. Calling LSApplicationWorkspace
  from HereLane's background thread to add a busy line there was left out.

## Phone run (iPhone 15 Pro, iOS 27, this branch's build)

`tools/ui-15.sh B312 install` of this branch's `build/iFizBox.ipa`, then through Web Inspector (pymobiledevice3
webinspector cdp + Runtime.evaluate) a new `signing.progress {bundleId: com.ryha.ifizbox.b312test, wait: 45}` every
2 s, while `tools/ui-15.sh B312 install` put a 300 MB padded test app with that bundle ID on the phone from the
desktop (installd, so "another app's install" as SideDrop's would be). Seen:

- LSApplicationWorkspace's installProgressForBundleID shows the desktop's installd install (0 → 0.62 → 0.72 →
  gone, about 1 s at the end of the 10 s the rig's install took).
- The watch started while it ran (t = 14.0 s): `{busy: true}` and the console line at once, `{busy: false}` 0.5 s
  later when it ended, then a fresh 45 s wait for ours, ending `installed: false` at 59.6 s (nothing else came).
- Watches started before the other install began took its progress as theirs (installing 62%, 72%) and answered
  `installed: null` (iOS 27's isInstalled can't tell, B229). That's the remaining gap: a watch can only call an
  install "another app's" when it is already there at the watch's start. If such an install then sits still, the
  60 s stuck limit still ends the row (install_stalled).
- The test app was removed afterwards (`ios uninstall`); the 15 keeps this branch's iFizBox build.

## Tried, failed

- First gate: `native/test_sideload.py` HandoffSourceTest forbids `return finish(` inside `watch` (every end goes
  through `done()`, so B76's lost-sight rule applies). The stuck fallback now calls `done(nil)`.

## Not verified

- The stuck ends (`install_busy`, `install_stalled`) on a device: needs an install of the same bundle ID that sits
  still for a minute; the desktop's installd install finished in seconds. Covered by node tests on the page side
  only; the Swift branch is read, not run.
- A real SideDrop re-sign on the 18 Pro (the user's phone, not here): the stand-in is a desktop installd install.
- The page's row text on the phone: checked by `install-busy.test.js` (rowStatus, runStatus, log), not shot on the
  15, as the rule keeps web UI checks off the phone.
- Cancel during busy: the watch's cancel checks run before the busy logic on every tick (unchanged code), not
  tapped on the phone.
- The pymobiledevice3 cdp server started for the run (port 9341) was left to end by its own 30 min `timeout`
  (no pid of it was kept to stop it by).
