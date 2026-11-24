# B415 Lower data protection at launch

What was done: the group fix now lowers, at every launch, each file and folder in the app's container from
NSFileProtectionComplete to CompleteUntilFirstUserAuthentication, unless the process's signature has Complete as its
default data protection or its entitlements can't be read (`native/groupfix/groupfix.m`, `lowerProtection`). Why: iOS
leaves the class on files when an app is re-signed without Complete, and a locked launch then cannot read them.
Changes to files need the phone unlocked; folders' do not. Links and the container folder itself are left alone.
The launch line in `Library/ifizbox-groupfix.log` ends `protection N files and M folders lowered from Complete[, K not
(error E)], of T in X ms`, or says `left alone (signed for Complete)` or `left alone (no entitlements read)`.

Order: it runs after `appRanBefore`, because lowering changes the change times that test reads, and before the first
preferences read. It uses getattrlist with ATTR_CMN_DATA_PROTECT_FLAGS and an fts walk (physical, no following links,
one device). The dylib is rebuilt with `build.sh`.

Test app (this folder): `app.m`, `early.m` and `build.sh`, with R87's `probe.m` linked before the group fix; the steps
are `locked.sh`, `step.sh`, `unlock.sh`, `code.sh` and `q.py`. Signer: this tree's signbench-linux with SideDrop's
profile. `complete.ipa` keeps its original signature asking for Complete, so the signer keeps it. `plain-old` is
signed with main's dylib, `plain-new` with the new one.

Phone (iPhone 15 Pro, iOS 27.0.1, temporary passcode):
- complete.ipa, first launch: all files and folders at class 1; with the new dylib it logged "protection left alone
  (signed for Complete)".
- plain-old over it: 5001 files under Application Support stayed at class 1; folders went to 0.
- plain-old, locked launch (first version of app.m): counter open errno 1, preferences open errno 1, passwords
  -25308. The app did not die because it opens files rather than maps them after locking; `early.m` was added to map
  them before the lock.
- Second locked try was invalid: the phone never locked, and WebDriverAgent had died.

What failed: WebDriverAgent restarted while the passcode was on, and iOS 27 then asks for the passcode ("Enter iPhone
Passcode for XCTest, Enable UI Automation"), which nothing here can type. To type through pymobiledevice3's
universal-hid-service I replaced the mounted disk image (`mounter auto-mount --replace`); that removed the old image
and hung in cryptexd (no reply in 60 s). Since then every mobile_image_mounter call hangs, also with no DDI, so there
are no screenshots and no WDA. The phone still has the temporary passcode and needs a person: turn the
passcode off, then restart. (Resolved 2026-11-24: the passcode is off, see below.)

Lesson: with a passcode on, never let `ui-15.sh up` restart WDA; call WDA directly. Do not use `auto-mount --replace`.

Not verified (2026-11-23; superseded 2026-11-24, plain-new is tested below): plain-new on the phone (the lowering
itself, its locked launch, its time for 5000 files, and the error behaviour when the first launch is locked); RyukGram
itself; a real background launch.

## 2026-11-24: Phone test finished

Build: `build.sh` takes LOCK_ID (the bundle ID). Its "old" group fix is `c0a0f075^` (before B415's code), since main
already has the new one. Test apps `probe.lock` and `probe.lock2` were prepared without a passcode.

Phone (iPhone 15 Pro, iOS 27.0.1):
- complete.ipa, then plain-old on both: 5001 Application Support files and the preferences stayed class 1; folders
  went to 0.
- probe.lock2, plain-new over plain-old, unlocked launch: "5003 files and 0 folders lowered from Complete, of 5029 in
  1227 ms". All files are class 3 (counter, preferences). The next launch: "0 ... of 5029 in 200 ms". Folders had
  already been lowered by iOS.
- Passcode on. Locked launch (launch, then lock during the probe's 18 s delay):
  - plain-old: counter open errno 1, preferences errno 1; the process was killed by SIGBUS reading the page mapped
    before the lock. This is the bug, reproduced.
  - plain-new: preferences and counter class 3 and readable, counter read, no SIGBUS; the process went on (no exit
    logged in 60 s). Keychain still -25308, as expected for an app whose passwords need an unlocked phone.
- First launch of plain-new locked (over class A files): "0 files and 0 folders lowered, 5003 not (error 1), of 5032
  in 1070 ms", then SIGBUS as before. This is inherent: lowering needs the phone unlocked once. isolate: "copied in
  generic read -25308; pinned no". The next unlocked launch lowered 5003 in 2378 ms and read the counter.
- Passcode turned off afterwards. Settings shows "Turn Passcode On"; lock/unlock through `ui-15.sh` works with no
  passcode. Test apps and the passcode file removed. lockdown's PasswordProtected reads false while unlocked even with
  a passcode, so it proves nothing.

Rig: the disk image left by `mounter auto-mount --replace` (27B52, mounted by iOS as a cryptex from codex.system;
survives restarts, `umount-personalized` refuses it, not listed by `ios image list`) made `ui-15.sh up` fail silently
for every task. `up` now accepts "already mounted at /System/Developer" and reports other mount errors. Verified: `up`,
`reboot`, lock-button, wake. This image has universal-hid-service: `pymobiledevice3 developer core-device
universal-hid-service tap -- X Y` (0..65535) taps without WebDriverAgent. It was the safety net, checked before the
passcode was set.

Not verified now:
- RyukGram/Instagram itself (the owner tests on their own phone).
- A real background launch while locked (push). Only a foreground launch that was locked during start was tested.
- Containers with more than about 5000 files. Each launch walks them all: about 200-290 ms for 5000, 1.1-2.4 s the
  one time they're lowered.
