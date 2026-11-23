# B392: an earlier install's password in the app's own group came back stale

## Verdict

A re-sign by the sideload build could leave an app reading an old password from its own keychain group. The
fix copies the shared item over it on the first launch, when the app was signed for the shared groups only until
then. Reproduced before the fix and shown gone after it, on the iPhone 15 Pro.

## Method

- Phone: iPhone 15 Pro (iOS 27), through `tools/ui-15.sh` under the B392 lock.
- Probe: `tools/resignprobe` with `early.m` linked in, so its initialisers run before the group fix. This stands in
  for RyukGram, whose IPA was no longer on disk. `build-early.sh` builds it, `step.sh` runs the steps.
- Signers: the built-in native signer and SideDrop's ad hoc identity A (App ID `com.ryha.sideload`).
- The item is `b392.session`.
- Build script: `ld64.lld` was not on PATH (found under `~/.rustup`). zsign's cache made it refuse a re-sign
  without `-f`. The phone was locked for about 25 minutes (F389) before the steps could run.

## Results

| Step | What | Result |
|---|---|---|
| A | Fresh install with the fix. An initialiser wrote a preference and a file before the fix loaded | Log says "ran before no, 1 preferences". Nothing copied. The old test would have said yes. |
| B | Delete, then sign the old way (only `TEAM.com.ryha.sideload`) | The own leftover (`...027`) is unreachable. The app wrote `...039` in the shared group. |
| C | Re-sign with the fix | Before the fix loads, a read returned the stale `...027` from the own group. That is the bug. After the fix, `...039` is in the own group. Log: 16 outside, 13 added, 3 taken over. |
| D | `probe.two` signed with both groups and no group fix, wrote its own item in this install. Another app wrote a newer shared item. Re-signed with the fix | Own item kept. 0 taken over, 3 left alone. |
| E | `probe.two` reinstalled fresh with the fix, own leftover from before, newer shared item present | "ran before no". The app then cleared the group-fix mark and was re-signed: "group fix before yes", 0 taken over, 16 left alone. |

Container folder births survived the re-sign (the container UUID changed). File change times were bumped by the
re-sign, but before the process started, so the "ran before" test reads them as the old state.

Fresh-start files: only the dyld cache and the SplashBoard snapshot. Their change times fell about 36 to 46 ms after
the process started. SplashBoard is skipped by name because it is the system's and a tap may make it earlier (not seen).

One of the 3 taken over in C (`kc-plain`) was written by another probe. The app had been reading it under the
shared-only signature, so taking it changes nothing for the app. Next launch: "marked earlier", value kept.

After the spec review: `Library/Caches/com.apple.dyld` and `Library/Saved Application State` born before the process
also count as "ran before" (an app whose every file was rewritten at launch). `retest.sh` ran A to C again with the
final dylib: "ran before no" when fresh; after the old-way sign, own `...039` replaced by the shared `...110`
(1 taken over, 15 left alone). A first try at the retest printed old "INSTALL REFUSED" lines from the rig's log: the
lock had not been obtained. D and E ran with the dylib before this change, which only touches the "ran before" test.

## Decision

No requirement that the shared item was written in this install. The app, under a shared-only signature, reads
that item anyway, so taking the newer one is what the app already sees.

## Phone left

- Probes uninstalled.
- Keychain items (`b392.session`, `probe.*`) stay in their groups; an uninstall keeps them.

## Not verified

- The folder-birth sign on its own: an app whose only files were all rewritten before the fix loads.
- A fresh launch by a Home Screen tap (go-ios launched every one).
- The real RyukGram (its IPA is gone) and a real login.
- Internet passwords.
- Items behind Face ID or passcode, or locked before first unlock. So the retry through `ifizbox.groupfix.takeover`
  was not run.
- A container restored from a backup.
- iOS 15 to 26 devices (iOS 27 only).
- A website signer on the phone. It uses the same dylib, but was not run on the phone.
- The stated remaining limit (an app another signer gave its own group plus the shared one, with no group fix, that
  has written no password in this install, can take another app's newer shared item) was reasoned, not run.
- SideDrop's own dylib is unchanged. It lives in its own repo, not in this task.
