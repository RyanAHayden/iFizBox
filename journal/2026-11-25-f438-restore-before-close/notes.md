# F438: Restore My VPN runs before iFizBox closes

Evidence file beside this note: evidence.txt (r4, f1, f2, off1 from the iPhone 15 Pro, iOS 27).

## Change

- Own update, This iPhone: closeWith(restore: true), from hereReady only, runs RestoreBack.closing() on its own thread right after downToClose(). It is limited to closeLimit (15 s).
- Exit is at max(VPN off + 6.5 s, back run over + 0.5 s). The backstops grow by the same limit only when a back run is owed (mayClose: owed, setting on, remembered, app not left).
- The rules are RestoreDue.step, with the update itself not counted as waiting. LocalVPN.state() ignores holds only while this close runs; RestoreBack's own looks stop then.
- Owed is cleared before Shortcuts opens and set again when it did not open (RestoreBack.run as before).
- The exit waits for Shortcuts' callback to bring iFizBox back in front, for at most the 15 s; only a later callback could come after the exit.
- The repeated runs and the release note are split out to F438a.

## Phone tests

Run on the iPhone 15 Pro, iOS 27, Tailscale up before, iFizBox in front. Not run in Chromium: the test needs real installd, the VPN and Shortcuts.

- Opening Shortcuts in the window works.
- The callback came back while the old copy was still alive, and it then exited.
- The window did not grow: back run 3.9 to 4.3 s, inside the 6.5 s. Exit about 7 s after the VPN went off, as in B440.
- iOS asked once more while the Shortcut ran (refused, Code=4) and went on at the exit ("No such process found").
- Build 1 (before the isClosing tightening): r1 to r4, 4 of 4.
- Final build: f1, f2, 2 of 2.
- All ended at version 0.99.0 without reopen or swipe, Tailscale connected per SpringBoard and checked by idevice.status after each one's reinstall.
- On the new copy, restore.due was false after r1 to r4, f1 and f2. Weak: with another VPN up it is false anyway. The owed mark itself is cleared before Shortcuts opens (code).
- Setting off (off1, final build): no Shortcut, exit 6.9 s after the VPN off, 0.99.0 installed.
- The in-app profile lacks Network Extensions, so the rig build (0.34.0) was reinstalled between runs. The target was the same build with version 0.99.0, installed from Documents (library.install).

## Left on the phone

- Final rig build.
- Restore My VPN off, as found.
- Tailscale on.
- F438.ipa removed; lock given back.
- The run's signed copy of F438.ipa may remain in the app's library.

## Not verified

- The last edit, after the phone runs: the route's backstop reads its extra time before the close starts (compiled and text tests only).
- An owed run with the app left, and no owed run (F438a).
- 10 runs (F438a).
- Shortcuts not opening, and an Allow prompt.
- A callback later than the 15 s limit (the exit then comes first; iOS is expected to refuse the launch).
- Clean Set VPN, cellular, VPNs other than Tailscale, iOS below 27.
- An update whose new copy has the VPN extension. The new copy asking nothing was seen only on a copy without it.
- A tailscale ping of the phone did not answer (the phone's tailnet node seemed not logged in or offline).
