# R89: RyukGram settings wipe, locked launch and keychain

Question: is the lasting RyukGram settings wipe a locked launch that lives long enough to write over the preferences? Also: the keychain session, B413 and B415's build over that container, and other ways the preferences can be emptied.

## Verdict
- A locked launch does not cause a lasting wipe. A process that starts while the phone is locked, with its preferences file in class A (Complete, unreadable), kept running past the unlock in 3 runs with RyukGram 456 (the test app run before them had a hot cfprefsd cache and is not counted). Writes made while locked were rejected by cfprefsd and lost. The file itself never lost a key: 202 keys before and after each run, 76 of them RyukGram's snake_case keys. After the unlock, a test write landed in the file within about 10 s.
- A locked launch does show a partial view. The process read only 50 to about 148 keys (domain keys) against 202 in the file, so it looks wiped. It also loses what it saves while locked. Ending and starting the app again shows the full settings. This explains a transient wipe, such as the reported 23:24Z launch that came back after a relaunch. It does not explain a lasting one.
- The group fix line matched the reported one: "8 preferences ... saw passwords error -25308 ... copied in generic read -25308; pinned no".
- A Complete-signed copy (the group fix from before B415) died of SIGBUS in 4 locked launches. The mapped files were the cause, not only crash_counter. The next unlocked launch of each had all 202 keys and the same passwords. Five forced crashes 2 s after start (unlocked) also left the settings and passwords unchanged, with no safe-mode screen. Whether Instagram's crash counter counted them is not verified.
- The keychain session was never lost in any run. Saved passwords stayed at 46 (app group) and 18 (shared group) before and after every locked launch, survivor run, crash and install. The locked read returns -25308 (WhenUnlocked class) with or without Complete, and works after the unlock. The reported lost login was not reproduced.
- B413 and B415's build (plain signature, this tree) installed over the Complete container kept everything. The first unlocked launch logged "protection 1600 files and ... lowered from Complete". Three locked launches then ran with no crash. Domain and file keys (202 each) were readable while locked. A key written while locked and one written after the unlock both persisted. Passwords stayed at 46 and 18.
- Every later launch still logs "protection 28 files and 0 folders lowered from Complete" (123 to 291 ms). Some files are made Complete again at each launch, by Instagram or iOS. None of them stopped a locked launch here. This is not a shown fault.

## Method
- Phone: iPhone 15 Pro, iOS 27.0.1. A throwaway passcode was set for the tests and turned off at the end. Settings shows "Turn Passcode On" again. The test app "Lock" was uninstalled. Instagram with RyukGram 456 was reinstalled plain, signed with this tree's signer, with B413 and B415 in.
- RyukGram copies: ry-P-new (group fix from this tree) and ry-P-old (group fix from before B415, c0a0f075^). ry-C-old is the Complete copy: Complete added to the original signature, then this tree's signer. The store IPA was used with spy.m loaded before the app. app.m is the test app, which seeds 300 keys.
- spy.m: Documents/r89.sleep makes the constructor sleep 18 s, so the phone can be locked first. Documents/r89.classA sets the preferences file to class A (fcntl F_SETPROTECTIONCLASS 64) just before the sleep. Instagram rewrites the plist within seconds, and a rewrite gives the default class again, so the first attempt was invalid. Documents/r89.crash calls abort() 2 s after start. Every 5 s the spy logs the domain key count (CFPreferencesCopyKeyList), the file key count (read directly) and whether the file holds the test keys. Each run writes its own value, so a persisted write can be told from an older one.
- locked.sh launches the app while unlocked, presses the lock button 2.5 s later, and types the passcode through WebDriverAgent. It then taps the app's icon, so the same process resumes. `ios launch` after the unlock restarts the app, so it was not used. prefs.sh pulls the preferences plist with pymobiledevice3 and prints counts only. Instagram's own log lines were read with `ios syslog`.
- The 18 s sleep means all app code runs while locked, as in B415 and R87. This is a stand-in for a real background launch.
- Problems met: the first locked test with the test app saw cfprefsd serve all 304 keys from its cache while the file was unreadable (cache hot). RyukGram's domain was cold (8 keys), so RyukGram was used for the main result. The 400 MB install made WebDriverAgent die, and iOS then asked for the passcode for XCTest. The passcode keypad is hidden from screenshots, so HID taps typed it (hidcode.sh).

## Other ways the preferences can be emptied
From strings in the RyukGram dylib and the Instagram binary. None was run through the UI.
- RyukGram Backup & restore: "Replace clears existing data for each ticked item, then applies the backup" (importSettingsAsProfile, merge:cleanup:).
- Per-menu "restore the default sections, order, and toggles".
- Device-ID roll: "Full reset to a brand-new device", with an option to "also wipe saved logins for a full reset". Not run.
- The option "Disable safe mode: Prevents Instagram from resetting settings after crashes (at your own risk)". Instagram's own safe mode (IGSafeModeChecker, with a crash threshold from FBInstacrashCounter, IGSafeModeAppDelegate, and the prompt "Something is not working, doesn't look right, or keeps crashing?") resets settings, according to that option's text. What it resets was not found.
- Instagram also has the selectors clearUserDefaults: and removePersistentDomainForName:. What calls them is not known.
- A reinstall or uninstall that makes a new container empties everything. In R87, an uninstall and an install under another App ID lost the container, but the keychain group kept the session.

## Next suspects (nothing shown)
(a) A new container: an install path that removes the app first, or a different App ID or bundle. The group fix log shows it ("container <id>", "container made <time>", "ran before no"). The next report should say whether the container id or "container made" changed.
(b) RyukGram's own Backup & restore Replace, Reset, or device-ID roll, run through its UI.
(c) Instagram's safe mode with a counted crash loop. Find what the counter counts and its threshold, then see what the safe-mode screen resets.
The next wipe's group fix log decides. Same container, and a preference count that fell with no "8 preferences" line, means the app cleared its own preferences. A new container means a reinstall.

## Filed
No B. Nothing shown is broken that B413 and B415 do not already cover. One follow-up R is filed by the main session.

## Not verified
- A real system background launch (push or refresh) while locked. It could not be triggered. The stand-in is a foreground launch that is locked during start.
- A Complete-signed copy that survives a locked launch: not achieved. ry-C-old died of SIGBUS every time (crash_counter deleted, other mapped files still class A). The surviving runs used plain-signed copies with only the preferences file forced to class A, which is the state that matters for the file. The pre-B413 signer itself was not built; Complete was added to the original signature and this tree's signer kept it.
- Class A through the locked window is shown indirectly: the spy's direct file read returned -1 (unreadable) from the constructor until the unlock, then 202. No file class was logged after the unlock.
- Instagram's own clearing on sign-out: not found in the strings and not run.
- A process left suspended for a long time. In one test iOS ended it, and the cause was not found.
- The longest locked run was about 25 s locked plus 60 to 85 s after the unlock. The reported launch lasted about 30 minutes, which was not reproduced.
- Whether a suspended locked process resumes after cfprefsd has dropped its state.
- RyukGram's own settings changes: none were made. Only test keys were written.
- RyukGram's Backup & restore, Reset and device-ID roll, and Instagram's safe-mode screen: strings only, not run.
- Whether Instagram's crash counter counted the forced crashes. Its threshold is unknown. RyukGram's text says three launch crashes in a row switch its Instagram config overrides off, not that the settings are deleted.
- The user's iPhone 18 Pro and its files.
- iOS 27.0.1 only.
- SideDrop's signer: not used, only its certificate and profile.
