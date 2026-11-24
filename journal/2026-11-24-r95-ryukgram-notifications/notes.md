# R95: RyukGram "You have new notifications on Instagram", which suspect

Question: RyukGram (Instagram 456, SideDrop ad hoc, App ID com.ryha.sideload) shows "You have new notifications on Instagram" instead of the push text. Which of two suspects causes it: (1) the group fix splits the app from its notification extension, or (2) the zxPluginsInject keychain pin differs between the app and the extension?

## Verdict
- Suspect 2 (keychain) is ruled out on this setup. Both app and extension end up in the same keychain group.
- Suspect 1 (app group files and suite) is the likely cause. The data placement shows it, but no extension process ran and no real push was sent, so it is not observed.
- Fix to file: keep the app's own container as master and mirror what the extension reads into the place zxPluginsInject gives it.
- Limits of that verdict (spec review): "likely" is a hypothesis, not a finding. The shim plist on this phone already holds the keys the extension names (auth device storage, device ID, mobile config) because this task's own zx-only runs (N, K) wrote it; so P5.txt shows divergence only for keys that look unrelated to push (install date, cleanup flag, revert-checker cache; usdid and privacy_flow_detection in the family suite). That a fresh install under the group fix leaves the shim plist without the auth keys follows from the code (the app writes only its own suite) but was not run. The mirror's compatibility with B227, B327 and B393 is by design (own container stays master, isolate pin unchanged), not tested. The follow-up must therefore start with a real push on a phone, with and without the mirror, before it is called fixed.

## Method
- Phone: iPhone 15 Pro, iOS 27.0.1. Instagram 456 signed in to the owner's own account. Nothing signed out. Only counts, key names and paths were read, never values.
- App: the real RyukGram 456 IPA from SideDrop (sha256 c773aac1ffe245a4871ef5553c2ac8b0af69749c6e200f33e23077e17096a10a), signed with this tree's signer (R89's sign.sh: SideDrop identity and ad hoc profile). The probe dylib spy.m was loaded through CydiaSubstrate, as in B390's prep.py.
- Entitlements after signing: the app and extension both have application-identifier S8NFX3A2LT.com.ryha.sideload, keychain groups [S8NFX3A2LT.com.burbn.instagram, S8NFX3A2LT.com.ryha.sideload] and app groups group.com.ryha.sideload.1-5. The original extension had keychain groups MH9GU9K5PX.platformFamily and .shared, and app groups group.com.burbn.instagram and group.com.facebook.family. So the probe in the app sees the keychain as the extension would.
- Variants (scratch builds of native/groupfix/groupfix.m, see groupfix-variants.diff):
  - P: production group fix.
  - K: keychain only (groups []), so no container or suite mapping.
  - C: containers and suites only, no isolate and no keychain strip.
  - N: no group fix dylib.
- Reports: reports/P4.txt, P5.txt, K.txt, C.txt, N3.txt. Scripts: mk.sh, step.sh.

## Findings
- zxPluginsInject.dylib, from its disassembly: at start it does a group-less SecItemCopyMatching for the generic password "zxPluginsInjectGenericEntry" (service ""), adding one group-less if missing. It takes that item's kSecAttrAccessGroup and pins every SecItem call (add, copy, update, delete) to that group.
- Its group container hook maps each original group to <profile group 1 container>/<original group>/. In an extension it also redirects the suite to the plist in that folder (strings: "appex suite redirect", "appex read MISS", "fanout mirror").

### Suspect 2: keychain (ruled out)
- Both groups hold a zx entry on the phone: S8NFX3A2LT.com.burbn.instagram (created 2026-11-23T19:19Z) and S8NFX3A2LT.com.ryha.sideload (19:33Z).
- A group-less read returns S8NFX3A2LT.com.burbn.instagram.
- Order test with two throw-away items (account r95order, deleted after): the group-less read returned the first group of the entitlements (burbn.instagram) in both orders, whichever item was older. So the extension pins to burbn.instagram, the same group the app uses.
- The extension's push decryption key (service com.instagram.notifications.hpke; the string sits in the extension binary next to METAHPKEDecryptionKit and "skippedMissingKeyID") is in S8NFX3A2LT.com.burbn.instagram, accessible class dku (readable while locked), created 2026-11-24T02:41:21Z.
- No items of class key, internet password, certificate or identity in either group. The original MH9GU9K5PX.* groups are refused to the app, as expected.
- Where suspect 2 could still bite: only if a group-less read finds no entry in the first group but one in the second. The app's own start-up (pinned) adds its entry in the first group at first launch with the fix, so this does not happen after that.

### Suspect 1: files and suite (likely cause)
- With the production group fix (P, C), the app's group.com.burbn.instagram data sits in its own container, Library/AppGroups/ (87-94 files, 12-14 MB: messagingMailbox, IGNotificationDeduplicationSQLiteDatabase, echo, media_bank, cask...). Its suite is ifizbox.appgroup.group.com.burbn.instagram (364 keys).
- With K and N (zxPluginsInject owns containers and suites), the app and an extension use the same place: <profile group 1>/group.com.burbn.instagram/ (25-26 files, 2 MB), with Library/Preferences/group.com.burbn.instagram.plist of 10-13 keys.
- In production the app never writes there again. After the N run, P5.txt shows the shim plist (modified 17:57Z, the last zx-only run) against the app's own suite:
  - group.com.burbn.instagram: 9 of 13 keys equal; 3 differ (mc_xapp_1st_dir_cleanup, mobileconfig_value_revert_checker_cache, com.instagram.app-install-date).
  - group.com.facebook.family: 3 of 7 equal; 3 differ (privacy_flow_detection, usdid, bundle-info://com.burbn.instagram).
- On a fresh install under the group fix, the shim plist would not have these keys at all.
- Names in the extension binary: instagram.app.auth.device.storage, com.burbn.instagram.IGdeviceID, FBMobileConfigStartupConfigs (12), IGNotificationDeduplicationSQLiteDatabase, group.com.facebook.family.instagramtokenshare.service/key, and the plain alert "You have new notifications on Instagram", which it falls back to. The first three sit in the group.com.burbn.instagram suite. So the extension reads suite data the group-fixed app writes somewhere else.
- Launching the extension by hand (pymobiledevice3 developer dvt launch, and ios launch of com.burbn.instagram.notificationextension) fails with "Failed to launch process with bundle identifier".

### Control N and K
- N (no group fix): sign-in kept. Keychain items stayed in burbn.instagram. Key counts moved 46 -> 40/38/44 across the A/B installs, with app churn and no sign-out seen.
- Extension-side data placement is the same in N and K.

## Filed
- B426 (normal), filed with `plan add`: the extension gets the group-fixed app's suite keys and small files through the shim folder. Keychain unchanged. Its check is on the iPhone 15 Pro with this probe, then a real push on a signed-in phone.

## Not verified
- No extension process ran. What it reads and misses is inferred from strings and data placement, not observed.
- No real push, so the full notification text was not seen. Only the fallback text is in the binary.
- The user's iPhone 18 Pro was not tested. It has a different install history, and its zx entries and shim folder state are unknown.
- That mirroring is enough. That the K variant changes notifications: only the data placement was checked, not the notifications.
- The launch cost of a mirror.
- Whether the extension also needs files in the group folder. Names seen: TerminationReporter, ReinstallDetection, CrossAppFetch, fba_extentions_event_store. The dedupe database IGNotificationDeduplicationSQLiteDatabase is created by whichever process needs it.
- That missing the three suite keys is what makes the extension fall back. Only that the data it names is not where it can read it.
- The profile group UUID in the probe's shim path is this phone's.
- Phone left as before: Instagram 456 reinstalled with this tree's production group fix and no probe. Library/r95-*.txt reports remain in Instagram's container. The r95order test items were deleted.
