# F438a1: Restore My VPN over own updates, on the fix

Evidence file beside this note: evidence.txt (runs on1-on10, off, none, left). Rig scripts beside it: run.sh, one.sh, set.sh, strong.sh, mark.sh, extra.sh, ver.sh, vpn.py.

Build: main at 44dd6b05 (F438a merged), unchanged. base.ipa is native/build/iFizBox.ipa built here by `native/build.sh ipa` (sha256 64d139fe4a84); F438a1.ipa is it with the version bumped by bump.py (sha256 678953886f7e). The signed copy is 0.99.0, from Documents as F438a1.ipa. The rig build is 0.34.0. iPhone 15 Pro, iOS 27. Phone needed: real installd, VPN, Shortcuts.

The owed mark is read from the phone without opening iFizBox: `pymobiledevice3 apps pull` of `Library/Application Support/ifizbox.vpn.backOwed`, and `Library/Preferences/com.ryha.ifizbox.plist`. Every run reads it before the new copy's first launch and after it. This is new in this rig, and a stronger check than restore.due.

## Phone runs

- on1-on10: 10 of 10 in front, setting on, VPN remembered, Tailscale up before. 0.99.0 was read before any reopen or swipe. One Shortcut run. Back run 3.7-4.5 s. Tailscale connected per SpringBoard after the exit; in on2-on9 Settings > VPN also said Connected with Tailscale selected. Owed file 0 before and after the new copy's first launch. New copy restore.due false, which proves nothing (in left it is false too with the mark 1: that copy lacks Network Extensions); the file and the strong check carry the result.
- Strong check (after the new copy was opened and read: the rig build installed over it and not yet opened, Tailscale off and iFizBox VPN selected in Settings, then opened). Valid in 9 of 10 (on1-on9): otherVPN false, restore true, due false twice, owed file 0.
- on10's strong check is invalid: the script did not find Settings' VPN page (cause not looked at), so Tailscale stayed on (otherVPN true). Its owed file read 0 all the same.
- off (setting off, Tailscale before): installed, no Shortcut, owed 0, due false.
- none (setting on, no VPN before): installed, no Shortcut, owed 0, due false.
- left (Home about 1 s after the call): installed, no Shortcut. Owed file 1 through the update, and the rig build asked (due true). Answer on: ok, Tailscale back (otherVPN true), owed 0. This is the positive control: the file does read 1, and the check does ask when it is owed.
- BackgroundCheck's pageCount/pageKeys/foundKeys, lowered at the hand-off, were kept in the new copy in 7 of 7 runs that had something to lower (on4-on10: 21 to 20; count and keys the same at its first launch, where the page removes foundKeys as it always does).

## Finding

- The owed mark kept in a file (RestoreBack.owed, Application Support, written atomically) survives the own update: owed 0 at the new copy's first launch in every on-run, and owed 1 through the update in left.
- The fix holds for the setting-on, VPN-up path (on1-on10; strong check on1-on9) and the no-Shortcut paths (off, none).

## Other UserDefaults keys (read in the code and from the preferences on disk)

- BackgroundCheck's pageCount/pageKeys/foundKeys: lowered at the hand-off, kept in 7 of 7 runs that had something to lower. If lost, the page's next count replaces them.
- ifizbox.selfUpdateHosted (dropped before the close on the Signing Server route): harmless if lost, since B445's bundle path check refuses it in the new copy.
- pushRegistration, watch, known, splashSnapshots, ocsp: not set near the close or rebuilt.
- ifizbox.cellular.owed (Cellular Installs, CellularRun): if its last false is lost, the new copy's launch does a put-back. Cellular data reads on: nothing. Cellular data off (or no signal): it opens Shortcuts once, unasked, to turn cellular data on. Cellular Installs ends well before the close on a This iPhone own update (inferred from code; the lost owed write was 2-4 s before the exit), so this is unlikely and was not seen. Filed as a follow-up: B457 (low), files CellularRun.swift and test_vpn.py.

## Left on the phone

- Rig build 0.34.0.
- Restore My VPN off and Tailscale on, as found.
- F438a1.ipa removed from Documents (the library may keep its signed copy).
- Lock freed.

## Not verified

- A new copy with a working VPN extension: the in-app profile lacks Network Extensions, so the new copy's asking was seen only in the rig build reinstalled over it.
- iOS below 27.
- Why on10's Settings step failed.
- Losing ifizbox.cellular.owed on a real cellular own update.
- The Signing Server route.
- VPNs other than Tailscale.
- Why iOS loses the UserDefaults write (the file fix avoids the question, the cause was not found).
