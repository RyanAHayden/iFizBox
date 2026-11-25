# F438a: Restore My VPN runs over own updates

Evidence file beside this note: evidence.txt (runs on2-on10, the DBG lines of y1-y16, and log lines of on1, left1-2, off1-3, none1-3, on11). Rig scripts beside it: run.sh, again.sh, ev.mjs, bump.py.

Build: main after F438, unchanged. iPhone 15 Pro, iOS 27. Phone needed: real installd, VPN, Shortcuts.

## Phone runs

- The signed 0.99.0 copy was signed once (run on1) and reused, so the new copy in each run was that same build.
- on1-on10: 10 of 10 in front, setting on, Tailscale up before. Version 0.99.0 was read before any reopen, one Shortcut run, back run 3.4-4.4 s. Tailscale connected per SpringBoard and otherVPN true after the reinstall. New copy restore.due false.
- But restore.due false proves little: another VPN is up, and the in-app profile lacks Network Extensions, so the new copy cannot ask.
- left1 (Home 1 s after the call), left2 (Home 4 s after the IPA was copied): installed, no Shortcut. The rig build was reinstalled, then asked "Turn Your VPN Back On?" (due true). Answering on brought Tailscale back.
- off1-3 (setting off): no Shortcut, exit 6.9 s after VPN off, installed.
- none1-3 (setting on, no VPN up before): no Shortcut, exit 6.6-6.9 s, installed.
- on11: after a passing run, Tailscale was turned off in Settings and the iFizBox VPN selected, then the rig build opened. It asked. So the owed mark was still set: the requirement "new copy does not run or ask again" FAILED. The 10 runs above could not see it.

## Finding

- The diagnostic build wrote owed (UserDefaults) at launch and exit, to a file, plus a marker file written by the setter. Runs y1-y16, 15 valid: exit always owed false. In 3 of 15, the new copy's (0.99.0) first launch, and the rig build's after it, read owed true while the marker file read 0 in all of them.
- So the UserDefaults write was lost across the update. Why iOS loses it was not found.
- An earlier 3+3 comparison: with CFPreferencesAppSynchronize still 1 of 3 (there the first copy could say it was the rig build, as the 0.99.0 copy had no diagnostics); without it, 0 of 3. With each set logged to a file (x1-x3), 0 of 3.

## Fix

- RestoreBack.owed is kept in a file in Application Support, written atomically, not in UserDefaults.
- docs/sideload.md and a test follow.
- An owed mark kept in UserDefaults by the version before is not read.
- The shipped fix was compiled and opened once on the phone, not run through updates. That is F438a1, with the release note.

## Failed tries

- Invalid runs d5 and y10: after a passing update, the rig's reinstall left the app "installing" for about a minute or more. The launch was refused (Busy) and the run never started. Cause not found; the next reinstall worked.
- Syslog buffering lost the tail of the log (fixed with PYTHONUNBUFFERED=1).
- The library reused the signed copy, so the first diagnostic new copies had no diagnostics. A new file name fixed it.

## Left on the phone

- Rig build with the fix.
- Restore My VPN off, as found.
- Tailscale on.
- Test files in Documents removed; lock freed.
- The library may keep signed copies of F438.ipa, F438x.ipa, F438y.ipa.

## Not verified

- The fix through own updates (F438a1).
- Other UserDefaults keys written shortly before an own update may be lost the same way (not looked at).
- A new copy with a working VPN extension.
- Setting off and no-VPN runs on the fixed build.
- Whether the mark is lost in updates on iOS below 27.
- Exit timing of left runs on the fixed build.
