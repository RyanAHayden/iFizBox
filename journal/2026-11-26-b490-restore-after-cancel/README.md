# B490: Restore My VPN after a cancelled install

User, 2026-11-26: after an install is cancelled, the Restore My VPN Shortcut's back run takes too long now.

## Cause

Measured on the iPhone 15 Pro, main build 81510e8e, This iPhone route. Cancel did not stop the AFC copy at all:
`IDevice.install` never read the cancel flag after the first connect. The copy went on (12.3 s for the 300 MB test
app), then installd installed the cancelled app (2.8 s), then our built-in VPN lingered its 3 s, then the back run
opened Shortcuts. Cancel 19:09:54.12, Shortcuts opened 19:10:12.51: 18.4 s.

RestoreDue.Now.waiting was not what held it: SignJob drops the job on Cancel at once. The 2 s re-look in
RestoreBack could add up to 2 s more when a look was already waiting.

## Change

- `native/sideload/idevice/IDevice.swift`: `HereRun.checkCancelled()`. Both copy loops (the single one and the debug
  parallel one) end on Cancel, the part already copied is removed from PublicStaging, installd is not asked when
  Cancel came during the copy, and a dropped connection is not reconnected after a Cancel. The end of `install()`
  tells LocalVPN whether it was cancelled.
- `native/sideload/vpn/App/LocalVPN.swift`: `installEnded(cancelled:)`. After a cancelled install our VPN goes off
  with no linger (log line "the install was cancelled: off now"); a normal install keeps the 3 s linger.
- `native/sideload/vpn/App/RestoreDue.swift`: `offAfter(linger:cancelled:)` and the `wakes(_:)` rules.
- `native/sideload/vpn/App/RestoreBack.swift`: a look that comes while another look waits for its next turn (later
  or ask) wakes that turn at once (`turnLater`, a semaphore), instead of being dropped until the 2 s re-look.

## Phone check

iPhone 15 Pro, iOS 27, Tailscale up, Restore My VPN on, 300 MB test app `com.ryha.ifizbox.b490test` installed via
`library.install`, This iPhone route. Script `cancel.sh`; readings in `evidence.txt` beside this README. `vpn.py` and
`ev.mjs` are adapted from the F438a1 journal; `ev.mjs` takes `PAGE=<cdp page id>`.

Before (main):
- before1: Cancel → Shortcuts opened 18.4 s later. The cancelled app was installed anyway.

After (this branch):
- after1: Cancel during the copy (about 19:12:08.5, read from the copy log; the script's own cancel line was
  overwritten in the log) → Shortcuts opened 19:12:08.756, about 0.3 s. Copy stopped, nothing installed, Tailscale
  connected again 2.8 s later.
- after2: Cancel 19:16:13.345 → our VPN off 13.430 → Shortcuts opened 13.659: 0.31 s. Tailscale connected 16.12.
- plain1 (no Cancel): install done, VPN off 3.1 s later (linger kept), Shortcuts 0.15 s after that, "back done".

The phone build for after1 and after2 was built before the reconnect clause was moved to the end of its condition
(`&& !cancelled()`, for a text test). Same meaning.

Found: another iFizBox copy is installed on the 15 (`com.ryha.ifizbox.4549VNVVAG`, left by another task). It also
registers `ifizbox://`, so the Shortcut's x-callback opened that copy instead of ours in after1 and after2 (our app
logged no "back done" there; the other copy came to the front). It also had a web inspector page, which my first
after2 attempt drove by mistake (I set its Restore My VPN on, then back off). Filed as a follow-up.

## Tests

- `tests/restoredue/main.swift`: cancel cases for `offAfter` and `wakes`.
- `test_restoredue.py` `test_cancel_releases_at_once`: text checks on the Cancel path.
- `test_vpn.py`: the `stopLater` index string follows the new signature.

## Put back

- Restore My VPN off, as found.
- Settings > VPN: iFizBox VPN selected and not connected again (Tailscale was off at the start).
- Test app uninstalled; `B490.ipa` removed from Documents.
- This branch's build left installed. Lock released.

## Not verified

- Cancel while installd is installing: not changed. iOS's own install goes on, and the hold ends when installd
  answers (about 3 s for this app). Not timed.
- Cancel during the app wait or the airplane wait (pause): the code path ends at once and skips the linger, but it
  was not run on the phone (needs the app in the background or cellular).
- The wake of a waiting look (`turnLater`): only the rules and text tests. In the phone runs no look was waiting
  when ours went off.
- A queue of several apps (IPA queue run, tagged cancel), the Signing Server route, the debug-only parallel copy,
  iOS below 27, and a VPN other than Tailscale.
- The log line after a Cancel names the watch's last step ("FAILED at removing the staged IPA"), which reads oddly.
  Left as it is.
