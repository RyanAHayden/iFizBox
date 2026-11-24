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
passcode off, then restart.

Lesson: with a passcode on, never let `ui-15.sh up` restart WDA; call WDA directly. Do not use `auto-mount --replace`.

Not verified: plain-new on the phone (the lowering itself, its locked launch, its time for 5000 files, and the error
behaviour when the first launch is locked); RyukGram itself; a real background launch.
