# C65: SideDrop gets B327's password isolation

SideDrop (`~/repos/sidedrop`) signs apps with the same group fix as iFizBox, but its copy predated B327: an app it
signs left its passwords reachable in `TEAM.com.ryha.sideload`, where another app's group-less delete signed it out.

## What I did

- Worked in a SideDrop worktree in my scratchpad, branch `c65-isolate` (commit `e1291e8`), pushed to
  `origin/c65-isolate`. **Not merged into SideDrop's main**: its `deploy.sh` is a cron pull-deploy of `origin/main`
  to the live server (apps.hayde.in), and the brief says to ask the user before changing the live server. So C65
  blocks with a CONFIRM to merge it.
- `native/groupfix/groupfix.m`: iFizBox's current file (B327 isolate, B339 calls through the real `SecItem*`
  pointers) with SideDrop's file names (`sidedrop-groupfix.plist`) and its header. The suite name and the preference
  marks (`ifizbox.appgroup.*`, `ifizbox.groupfix.*`) stay the same as iFizBox's on purpose, so an app signed by one and
  then the other keeps its data and copies the shared passwords only once. Diffed against iFizBox's with the names
  swapped: only the header and the B339 comment (which names the other fix) differ. Taking B339 too keeps the rule
  "only the file names differ", and with both dylibs in one app neither loops.
- Rebuilt `sidedrop-groupfix.dylib` with `native/groupfix/build.sh` (iPhoneOS27.1.sdk); its `.source-sha256` updated.
- `app.py`: `group_fix_plan(original, profile_ents, keychain_groups)` sets `isolate` to the first keychain group
  whenever there are two (as `core/groupfix.js` / `GroupFix.swift`), so every app but the App ID's own gets the fix,
  even one whose original names nothing; iFizBox's own IPA still never does. `sign_ipa` passes the signed app's
  `keychain-access-groups`. `SIGNER_VERSION` 1 -> 2, so every signed copy on the server is signed again on the next
  resign (the dylib hash in the stamp would do that too).
- `test_app.py`: plan cases (isolate with and without original groups, one group = none), the Probe config carries
  `isolate`, and Demo (no groups in its original) now gets the dylib with `isolate` only. The whole suite passes
  (`uv run ... python test_app.py`: ok).
- `docs/developer-account.md`: the shared group paragraph now says what isolate does.
- Nothing in iFizBox's `native/groupfix/groupfix.m` needed changing: it already names SideDrop's fix in its B339 comment.

## Tried and failed

- none

## Not verified

- **A SideDrop-signed app on a phone.** zsign isn't on this machine, and a real sign needs SideDrop's .p12 and
  profile on the server. The dylib code is iFizBox's, verified on the iPhone 15 Pro in B327/B339; only the config file
  name differs, which `test_app.py` checks against the dylib's strings. Worth a look once deployed: sign out/in
  survives another app's fresh install.
- **The live server.** Not deployed (above): it waits for the user's OK to merge `c65-isolate` into SideDrop's main.
  Merging re-signs every app on apps.hayde.in (`SIGNER_VERSION` 2).
