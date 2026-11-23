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
    `signer.log` (Install, Re-sign, updates, sign-ahead); My IPAs only NSLogs them (follow-up below).
  - Website: `runSignJob` returns `signLog` with the same two lines (`core/websign.js keychainLogLine`,
    `core/groupfix.js groupFixLogLine`).
  - Tests: `native/sign/tests/main.swift` (B211 test: the keychain line of a real sign, the own IPA's "none" line,
    `logLine` with legacy, `keychainLine`), `web/app/core/b327-sign-log.test.js`, `web/app/websign-job.test.js`.
- docs/signing.md: the log lines, under "Keeping an app's data across re-signs".

## Tried and failed

- `ios list` / go-ios: no usbmuxd, no phone on USB (above). The Wi-Fi lockdown route (memory: read-only StartSession
  works on the LAN) can't install or pull app containers, which the matrix needs.

## Not verified

- The whole device reproduction: no path was run on the iPhone 15 Pro (not plugged in). So the cause is not found,
  no fix for it is in this commit, and there is no test that fails on it yet. B327 is blocked until the phone is
  back on USB.
- Suspect 1 (shared-group deletes) is from reading Apple's documented keychain behaviour, not seen on a phone.
- The new log lines on a phone's Console Logs: only checked through the Swift tests on Linux and node tests.
