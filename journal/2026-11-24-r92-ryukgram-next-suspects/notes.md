# R92: RyukGram settings wipe, next suspects

Question: R89 disproved the locked write as the cause of the lasting RyukGram settings wipe. What are the next suspects, and does any of them show the wipe?

## Verdict
- No wipe reproduced. Nothing shown broken. No B filed.
- (a) Update path: by code, iFizBox never removes the app before an update or re-sign. A new container arises only when the person deletes and reinstalls the app, which the signing error text tells them to do.
- (b) RyukGram Backup & restore and Reset: run on the phone. Reset removed only the 3 keys the Profiles screen counts as changed. Replace did not empty the preferences; the net result was more keys, not fewer.
- (c) Instagram safe mode: static only, from strings. Its numeric thresholds and what it resets were not found.

## Method
- Phone: iPhone 15 Pro, iOS 27.0.1. Instagram with RyukGram 456 (v1.6.0 in its settings), signed in to the person's own account. Nothing that signs out was run.
- Settings was opened by holding the three lines at the top right of the profile page.
- Key counts were read from Library/Preferences/com.burbn.instagram.plist over USB with journal/2026-11-24-r89-ryukgram-locked-write/prefs.sh. Counts only.
- (a) was read, not run: iFizBox native/Sources and native/sign, and SideDrop's app.py in container ix-sidedrop-sidedrop-1 over ssh. The SideDrop container was only read.
- (c) was read, not run: strings from the Instagram binary (SideDrop's com.burbn.instagram.ipa, RyukGram injected) and FBSharedFramework.

## (a) Update path (by code)
- iFizBox has no uninstall call in the signing or install path. native/Sources has only Apt's jailbreak "uninstall-app" command, which drops a waiting IPA.
- Sideload.installedAppID and IPASigner (line ~160, B138) keep the App ID the app was installed with. AppIDMatch.pick chooses another profile if one gives that App ID.
- If no profile gives it, signing stops with code appid_mismatch. The text says to import the profile it was installed with "or delete the app from the Home Screen and install it again (its data is lost)" (native/sign/AppIDMatch.swift). The installd error is 15, MismatchedApplicationIdentifierEntitlement.
- So a new container appears only when the person follows that advice. That happens when the signer, team or App ID changes, for example switching between SideDrop's Ian-team profile and iFizBox's own profile, or SideDrop's App ID being regenerated.
- SideDrop has no uninstall or remove step. It re-signs the IPA and serves an itms-services link, so iOS installs over the old copy.
- With an explicit BUNDLE_ID (com.ryha.sideload), each app gets application-identifier TEAM.com.ryha.sideload and keychain groups TEAM.<bundle id>, then TEAM.<App ID>. With a wildcard, it gets TEAM.<bundle id> only. Changing BUNDLE_ID between those shapes changes the App ID of every copy it signs. The phone then refuses the update (error 15) until the app is deleted.
- Not shown to have happened to the reporter.

## (b) RyukGram Backup & restore, Reset, Replace (run on the phone)
- Profiles screen: "Default profile", "All other accounts", "3 changed". Baseline: 204 keys in the plist, 76 of them RyukGram's snake_case keys.
- Backup & Profiles > Reset, ticking only Settings ("972 preferences"), confirm "Reset selected data? This can't be undone", then Restart. The plist went from 212 to 209 keys. Only 3 were removed: reels_limit_mode_migrated, ryg_devicespoof_device_id, shortcut_inbox_seen. That matches "3 changed". After relaunch the app wrote back to 212 keys and nothing else was removed. The 8 keys added between baseline and this step were first-run keys: RyukGramFirstRun, ryg_active_profile, ryg_whatsnew_seen, and per-account chat_bg_*, lock_chats_* and share_sheet_* keys.
- Export of Settings only: saved as a 39 KB json into Instagram's Documents folder through the Files picker, named RyukGram-v1.6.0-backup-20261124-114449.json. It was left there on the phone.
- Import with Replace, "Current settings", then Apply. Before: 214 keys. Right after: 1183 keys (1052 snake_case), with 0 removed and 969 added. That is the whole 972-preference registry written out with values. The same 1183 after a restart. Instagram stayed signed in.
- So neither Reset nor Replace emptied the preferences here. Replace "clears then applies", but the net result was a superset.
- Not run: device-ID "Clear device & relaunch", "Mask everything & relaunch" and "Roll + clear IG data". These clear saved logins and cookies, and this is the person's account. Earlier evidence in journal/2026-11-23-b390-ryukgram: "Mask everything & relaunch" cleared sign-in but kept settings.
- First-run prompts on the phone (Enjoying RyukGram?, ATT) were answered "Maybe later" and "Ask App Not to Track".

## (c) Instagram safe mode (strings only)
- Counter fields: pre_main_crash_count, post_main_crash_count, early_crash_count, last_timestamp, safe_mode_enable_count, safe_mode_actually_applied_in_past, safe_mode_actually_applied_successfully. They sit in memory-mapped "crash_counter" and "crash_counter_metadata" files (FBInstacrashCounter; GetPostMainCrashCount, Get/SetSafeModeEnableCount).
- IGSafeModeChecker is built with initWithInstacrashCounterProvider:crashThreshold:. A crashThresholdMinutes value exists, and IGAppServicesPossibleInstacrashThreshold is a separate threshold. The numeric values are in code or remote config, not in strings, so they were not found.
- The safe-mode screen (IGSafeModeAppDelegate, IGSafeModeMainViewController) has no readable text in the binary.
- Recovery strings: instacrash_recovery_clear_cache, instacrash_recovery_from_backup, "Instacrash loop detected", instacrash_mitigated. They sit next to MobileConfig params-map strings (UFS-%@, copyFromPreviousFlatBufferToMemory). That suggests recovery acts on Instagram's MobileConfig store and caches, not on the app's NSUserDefaults.
- clearUserDefaults: is a selector in the binary. Its caller is unknown; it sits among tab-bar selectors, so it may be unrelated UI.
- RyukGram's own text: "Disable safe mode: Prevents Instagram from resetting settings after crashes (at your own risk)". "Disable all tweak options: Instagram runs stock while this is on. Turn it back off to restore your settings." Its MobileConfig overrides say "If Instagram crashes on launch three times in a row, your changes are switched off, not deleted." and "Disabled after repeated crashes." Nothing in the strings says safe mode deletes RyukGram's preference keys.
- Not run through the UI. A crash loop on the signed-in account was not forced.

## Possible explanation (not shown to be the cause)
- RyukGram has profiles ("Default: Active", "All other accounts"). Settings are stored per profile, and a profile can be tied to accounts. An account switch or a profile switch could show defaults while the keys are still in the plist. Not tested: there is no second account.

## Filed
None. No B. Nothing shown is broken.

## Next step
- The reporter's group-fix log decides the next case. Same container id and a falling key count with no "8 preferences" line means the app cleared its own preferences. A new container id or "container made" time means a reinstall.
- Also ask which profile is active in RyukGram's Backup & Profiles.

## Not verified
- The user's iPhone 18 Pro. Only iOS 27.0.1 and RyukGram 456 were tested.
- Device-ID roll and clear (all three options above): not run.
- Account or profile switch: not run, no second account.
- Numeric safe-mode thresholds, and what the safe-mode screen resets: not found.
- Whether Instagram's crash counter would count a crash loop: not forced.
- SideDrop's behaviour when its App ID or BUNDLE_ID changes: read from code only. Nothing was changed in SideDrop.
- Whether the reporter's install was a reinstall: not known from the report.
