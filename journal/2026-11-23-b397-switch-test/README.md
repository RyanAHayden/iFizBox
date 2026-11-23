# B397: Test Install Switch on the phone

## Summary

Test Install Switch (This iPhone's Install Switch page, `vpn.testSwitch`) took 7 to 10 seconds, sometimes longer, and
its spinner was reported to stop. The test now answers sooner, says its step as the row's subtitle, and fails first
when the Shortcut is missing so it no longer takes Tailscale off. The stopped spinner was not reproduced; a safeguard
restarts the spinners on the return from Shortcuts, and its need is unproven.

Checked on the iPhone 15 Pro (iOS 27.0.1, Wi-Fi). Shortcuts, the VPN and WebKit's return to the front exist only on the
phone, which is why the test ran there.

## Times

`vpn.testSwitch` call to answer, before -> after:

- Tailscale on: 9.5-9.9 s -> 6.1-6.4 s. Of the after time, 4.2-5.1 s is Tailscale coming back.
- No other VPN, right after a real delete and re-add: 4.7 s -> 2.4 s (the 2.4 s was not measured right after a re-add).
- Tailscale on, right after a real delete and re-add (Allow asked in the check): 6.3 s after.
- Shortcut missing: 7.8 s -> 2.1 s.

Steps before (Tailscale on): Shortcuts open to the app in front in about 1-2 s, linger 3.0 s, put back 4.7-4.8 s. No end
run occurred in these.

Likely causes of "took forever": the linger plus the put-back; a stall where Open never ran waited 25 s (seen in F389).
Now 5 s in front without Open ends it, and the put-back wait is 12 s in a test before the end run. The answer waits for the
end run (it opens Shortcuts), so no alert is under it.

## What was built

- `web/app/core/installroute.js` (`switchTestResult`): the success alert says "then your VPN came back" only when another
  VPN was on or selected before and is again (`vpnBack`). Otherwise "then went off again", or on cellular "then data came
  back on".
- `web/app/screens/installroute.js`: the test's step (`testStep`: Opening Shortcuts…, Connecting…, Putting Things Back…)
  is the row's subtitle, not its detail at the right. The detail cut the label off.
- `native/sideload/vpn/App/LocalVPN.swift`: a missing Shortcut fails the test before the built-in VPN connects, so
  Tailscale stays on. The test refuses at once while an app installs. A stale `tripOpen` from an earlier trip could count
  as a pass when the begin failed before the trip; that is fixed.
- `web/app/nav/respin.js` (called from `web/app/app.js`): on the return to the app, each running `hud-spin` animation is
  paused and played again at the same time. It is a safeguard only.
- Test Connection: its end painted only the old drawing, so its row could keep spinning. Fixed and node-tested; phone
  test with Tailscale passed in 2.0 s.
- `docs/sideload.md` and `docs/settings.md`: the test's steps are named as the row's subtitle, and the rules and the
  `vpnBack` answer field are written down.
- `release-notes/B397.md`.

## Bugs found on the phone

- A missing Shortcut test connected our VPN anyway. It took Tailscale off and left it off, with a "Your VPN Is Off"
  alert stacked on "Shortcut Didn't Run". Now it fails first and Tailscale stays on.
- The success alert said "then your VPN came back" with no other VPN. Now it says "went off again".

## Spinner

Not reproduced standing still. Tried, with 60 fps recordings (frames 100 ms apart all differed):

- A test from a plain tap, with no JS polling, and right after a real re-add.
- iOS 26 and iOS 6 eras; Low Power Mode.
- Spinners drawn before, at hidden, while hidden, and at the return; 4 s and 45 s away.
- JS: same element, animation running, `currentTime` moving. Reduce Motion was off (its rules only slow the HUD spinner).

With the released 0.26.0 IPA: coming back from Add, the row showed "Add" with no spinner while its check ran. The page was
redrawn by a second drawing without that state. B395 already fixed that.

After `respin` runs, the spinner turns in frames 100 ms apart after the return (`test-after.png`, 4 frames 100 ms apart).
Whether `respin` is needed is unproven.

## Not verified

- The user's own phone (18 Pro) and its spinner.
- Cellular (no SIM).
- The stall path (5 s in front).
- The end-run retry in a test (a VPN that doesn't come back within 12 s).
- An older Install Switch's test.
- Reduce Motion on.
- A no-VPN test right after a re-add with the final build.
- iOS 15 to 26.

## Tried and failed

- ui-15 `launch` of Shortcuts with our native alert up did not bring it in front at once. Native alerts are not in the DOM.

## Phone state

- This branch's build; Install Switch re-added once; Tailscale connected; Low Power Mode off.

## After the spec review

Built and node-tested only, not run on the phone (add to Not verified): a test waits for a queue that just ended
(linger, put-back) instead of refusing; an install going on answers "Not Tested"; the older two-run path checks that
Cellular Data came back and runs no end when Shortcuts never opened; a run that never opened Shortcuts keeps Added.
The cause of the reported still spinner is not proven (see above).
