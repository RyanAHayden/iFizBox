# B327: re-signed apps lose their logins and settings again

User report (2026-11-22, Lite 0.20.x): YouTube, RyukGram and others came back signed out with their settings gone,
after making a new SideDrop invite link and at other times.

## What I did

- Looked for the iPhone 15 Pro first: `ios list` fails (`dial unix /var/run/usbmuxd: no such file`), `usbmuxd.service`
  is inactive, and `lsusb` shows no Apple device. The phone isn't plugged in, so the device matrix in the brief
  (sign in, set a setting, then every path that rewrites the app, checking the data folder, Library/AppGroups, the
  suite and the keychain with `tools/resignprobe`) couldn't run this session. B327 is blocked on that.
- Read every path that signs and installs on the Lite build, looking for one that drops the group fix, changes the
  keychain group order, or deletes the app:
  - Install / Re-sign / Re-sign All / update (`Sideload.signAndOpen`), sign-ahead and Confirm (`SignAhead.sign`), My
    IPAs (`MyIPAs.signIfNeeded` -> `IPALibrary.sign`), the F343 kept IPA (an input to the same `signAndOpen`): all
    go through `IPASigner.sign`, which works out the keychain groups (`Profile.entitlements(for:keptID:)`) and the
    group fix (`GroupFix.plan`) the same way every time. The order is always `[TEAM.<own ID>, TEAM.<App ID>]`
    under a profile whose keychain entry is `TEAM.*`.
  - Nothing in the Lite build uninstalls an app. installd's `MismatchedApplicationIdentifierEntitlement` is caught
    before signing (`AppIDMatch`) or worded after; nothing falls back to delete-then-install.
  - iFizBox's own keychain code (`OwnKeychain.moveAll`, `SignBridge.confirmImport`) only matches iFizBox's own items
    (service and account, or the certificate's public key hash), so it can't take other apps' items.
  - SideDrop (`~/repos/sidedrop`, read only): its `app_entitlements` writes the same `[TEAM.<bid>, TEAM.<App ID>]`,
    and its `native/groupfix/groupfix.m` differs from ours only in its file names (diffed with the names swapped):
    the same `Library/AppGroups/<group>` folder, `ifizbox.appgroup.<group>` suite and keychain stripping. Its plan
    never sets `legacy`. So an app signed by one and then the other keeps the same places.
- Found no path in iFizBox that loses the data. What the code can't rule out, to test on the phone first:
  1. **Items still in a shared group.** `TEAM.<App ID>` (also the application-identifier, so always an access group)
     and every app group of the profile are keychain groups every app under SideDrop's App ID can reach. A
     `SecItemDelete` without `kSecAttrAccessGroup` deletes in every group the caller has; and the group fix turns
     every delete that named a group into exactly that. So any app that clears its keychain (on a fresh install,
     a logout) deletes what other apps still have in the shared groups: items written before B227/SideDrop's B23,
     and items only ever changed with `SecItemUpdate` (which doesn't move them to the first group). An app that
     signs out that way may then clear its own settings. That fits "at other times" and "after an invite link"
     (installing or reinstalling something). The probe can show it: probe A writes, then is re-signed; probe B
     (fresh) wipes with a group-less delete; does A still read its items?
  2. **Both group fix dylibs in one app.** An IPA SideDrop signed and iFizBox signed again would carry both
     `sidedrop-groupfix.dylib` and `ifizbox-groupfix.dylib`. Each rebinds every image's `SecItem*` pointers but its
     own, so each points the other's at itself: the first keychain call recurses until the stack runs out. That's
     a crash, not a sign-out, and needs a SideDrop-signed IPA as iFizBox's input (My IPAs import), so it isn't this
     report. Filed as a follow-up (below).
- What the brief asks for that doesn't need the phone: **every sign now logs its keychain groups and its group fix
  config**, so the next report can be read from Console Logs.
  - App: `IPASigner` logs `Keychain: <groups in order> (application-identifier <id>)` (`Profile.keychainLine`) and
    `Group fix: <groups> -> <target>; keychain groups stripped; <legacy> copied in once if the app ran before`, or
    `Group fix: none (<why>)` (`GroupFix.logLine`): the original names no groups, iFizBox's own IPA, the executable
    missing, or no fix dylib in this build (which was silent before: an app could be signed without the fix with
    nothing in the log). The lines reach Console Logs through the install's log on every route that forwards
    `signer.log` (Install, Re-sign, updates, sign-ahead), and now My IPAs' Install too (`signIfNeeded(log:)`); My
    IPAs' plain Sign has no run log and still only NSLogs them.
  - Website: `runSignJob` returns `signLog` with the same two lines (`core/websign.js keychainLogLine`,
    `core/groupfix.js groupFixLogLine`), and `signing/browser.js` writes them to the browser console. Without the
    dylib it still works out the plan, so "nothing to fix" and "left unmapped" read apart as in the app.
- Spec review: fixed the website's "no dylib" wording (it said "unmapped" for apps with nothing to map), sent My
  IPAs' sign log to the page and the website's to the console. Filed B339 (two fix dylibs in one app) and B340 (My
  IPAs signs without installedAppID).
  - Tests: `native/sign/tests/main.swift` (B211 test: the keychain line of a real sign, the own IPA's "none" line,
    `logLine` with legacy, `keychainLine`), `web/app/core/b327-sign-log.test.js`, `web/app/websign-job.test.js`.
- docs/signing.md: the log lines, under "Keeping an app's data across re-signs".

## Tried and failed

- `ios list` / go-ios: no usbmuxd, no phone on USB (above). The Wi-Fi lockdown route (memory: read-only StartSession
  works on the LAN) can't install or pull app containers, which the matrix needs.

## Session 2: the device repro (iPhone 15 Pro on USB)

Probe runs in `probe-runs.jsonl` (tools/resignprobe; identity A = SideDrop's adhoc profile, team S8NFX3A2LT, App ID
`com.ryha.sideload`, keychain `TEAM.*`; "sidedrop" = SideDrop's old signing, keychain `[TEAM.com.ryha.sideload]`, no
fix; "native"/"web" = this branch's signers). Fresh bundle IDs per run (a1...), because keychain items outlive an
uninstall: the B227 probe's ID found its own 2026-11-20 items in `TEAM.com.ryha.ifizbox.probe` and read those
instead of the newer ones in the shared group (a stale login is a sign-out too).

**Cause found: suspect 1, worse than the brief's version.** Before the fix (main's dylib):
1. a1, a fresh app signed by our native signer (own group first), read `probe.plain` group-less and found the one an
   earlier app (another bundle ID) had left in `TEAM.com.ryha.sideload`: status OTHER. It never wrote its own, so it
   lived on another app's item in the shared group (and kept it there: an update doesn't move an item).
2. Re-signing a1 kept everything (data folder, prefs, Library/AppGroups, suite, keychain).
3. w1, another fresh app, deleted `probe.*` without naming a group on its first launch (as apps that clear the
   keychain on a fresh install do). Its deletes reach every group it has, `TEAM.com.ryha.sideload` included.
4. a1 relaunched: data folder, prefs, AppGroups, suite kept; **its keychain passwords gone** (kc-plain, kc-afu NEW).
So any app under SideDrop's App ID whose items sit in `TEAM.<App ID>` (written before B227, adopted from there, or
changed only with SecItemUpdate since) is signed out the moment any other app under that App ID clears its keychain:
installing a new app (after an invite link, or at any time) does it, with no re-sign of the victim. The group fix
makes it more likely: it strips the group from every delete an app makes, so even a delete aimed at an app's own
named group goes group-less. The data container never moved in any run: settings lost with the login fit an app
that clears its settings on sign-out (not shown for YouTube/RyukGram themselves).

**Fix: `isolate`.** Both signers now give every app whose signed keychain groups are `[TEAM.<its ID>, TEAM.<App ID>]`
the group fix with `isolate: TEAM.<its ID>` (also apps whose original names no groups). The dylib:
- names that group on every generic and internet password call (add, read, update, delete; update attributes lose
  their group), so no other app's call reaches its passwords and it never sees theirs;
- first launch with it: an app that had run before (preferences not empty) copies every password it can see outside
  its own group into it (never over one it has; protected items skipped) and marks `ifizbox.groupfix.isolated`; a
  fresh install copies nothing. If an item couldn't be read (before the first unlock), calls stay as before and the
  next launch tries again;
- keys and certificates keep the old stripping.
SignerStamp and WEB_SIGNER_VERSION go to 2, so every installed app shows under Needs Re-sign and gets it.
Log line: `Group fix: ...; passwords kept in TEAM.<its ID>, the shared groups' copied in once if the app ran before`.

After the fix (this branch's dylib, on the 15 Pro):
- a3 signed the old SideDrop way (items in the shared group), then by our native signer: passwords copied into
  `TEAM.com.ryha.ifizbox.probe.a3`, reads see only that group; w3 (old SideDrop way, so its deletes do reach the
  shared group) wiped `probe.*`; a3 relaunched: **everything kept**. Re-signed again: kept.
- a4, a fresh app with the fix: NEW everywhere, didn't take w3's items from the shared group.
- a5 signed by the website's signer (websign-job + zsign WASM): config carries `isolate`, kept across a re-sign.
- Data folder, prefs, Library/AppGroups and the suite were kept on every re-sign in every run, SideDrop's signing to
  ours included. Once (a3, sidedrop -> native 5 s after the first launch) the standard prefs' marker was NEW while
  the launch counter in the same prefs was kept: not reproduced (a6, the same steps with 8 s between: kept); taken
  as the probe being replaced before cfprefsd wrote its first launch's last key.
- Tests that fail without the fix: `web/app/core/b327-sign-log.test.js` (isolate in the plan, also with no original
  groups; in the config), `native/sign/tests/main.swift` B211 test (the same for GroupFix.swift).
- Phone left as found: probes a1-a6, w1, w3 uninstalled; `com.ryha.ifizbox.probe` (there before) reinstalled; their
  keychain items stay (iOS keeps them after an uninstall). iFizBox 0.20.1 untouched. Lock given back.

## Not verified

- The re-sign paths inside iFizBox on the phone (Re-sign, Re-sign All, sign-ahead/Confirm, F343 kept IPA, a source
  update, Needs Re-sign, self-update): not run through the app's UI this session; they all go through
  `IPASigner.sign` (read in session 1), which the native signer runs used (signbench-linux, the same Swift code).
  B227 ran Install and Re-sign through the app on this phone: kept.
- YouTube and RyukGram themselves: no account on the test phone; the cause is shown with the probe, not with them.
  Whether they clear their settings on sign-out is not checked.
- The copy-in for items with access control (biometry) and before the first unlock: the 15 Pro has no passcode.
- Apps the user already has: they get the isolation only when re-signed (Needs Re-sign after the stamp bump); items
  another app deleted from the shared group before that are gone.
- SideDrop still signs without `isolate` (its own dylib): apps it signs stay exposed; a follow-up for SideDrop.

