# B390: RyukGram signed out and lost its settings again

User report (2026-11-23): RyukGram, signed with the sideload build, came back signed out with its settings gone.

## Verdict

The user's loss was NOT reproduced. No cause of it was shown. Nothing was changed about where data is kept. What
was added: a per-launch log (`Library/ifizbox-groupfix.log` in the app's container, see docs/signing.md) so the next
report can say which part lost what.

## Method

- Phone: iPhone 15 Pro (iOS 27), through `tools/ui-15.sh` under the B390 lock.
- Apps: real RyukGram 453 and 456 IPAs (sha256 453 `5194ab9a14096cab726695fbf1a777190bcfb0ecb2ed5d70a8b9cd24f0fa0787`,
  456 `c773aac1ffe245a4871ef5553c2ac8b0af69749c6e200f33e23077e17096a10a`). Changed from the store IPA only by:
  `UIFileSharingEnabled`, and a spy dylib (`spy.m`) loaded as a dependency of CydiaSubstrate so it inits before
  RyukGram.
- The spy logs SecItem calls with caller and group. It dumps standard prefs, suites, `Library/AppGroups`, and
  keychain items with their groups. It plants markers:
  - keychain items in `MH9GU9K5PX.platformFamily`, `.shared`, and with no group, written through FBSharedFramework's
    own SecItem pointers;
  - files and suites in the three original app groups;
  - RyukGram's setting keys (`hide_ads_comments`, `hide_meta_ai`, `no_suggested_post`, `hide_live_feed`) written to
    standard defaults by the spy, not through RyukGram's UI.
- The spy was used instead of FLEX or Console.
- Identity: SideDrop's ad hoc profile, App ID `com.ryha.sideload`.
- Signers: "pre-B327" = the worktree at `c761c9f4^`. SideDrop's signer = its groupfix dylib with `isolate`, entitlements
  own group first, through the rig's `zsign -l` (a stand-in for SideDrop's `app.py`, not the live server).
- `step.sh`, `cmp.py` and `prep.py` drive the steps and compare the snapshots.

## Steps and result

Each step is a launch of about 45 s, then a snapshot.

| Step | What | Result |
|---|---|---|
| 1 | pre-B327 453 (fresh) | markers, RyukGram settings, all non-volatile prefs, suites, Application Support/RyukGram, and Instagram's device/family-ID items (`unique_id`, `instagram.deviceid`, `instagram.mid`, `cloud_identifier`; all in `S8NFX3A2LT.com.burbn.instagram`) kept |
| 2 | re-signed 453 with isolate | kept. Two leftover `probe.*` items from another app were copied in from `S8NFX3A2LT.com.ryha.sideload`. Standard prefs gained only `ifizbox.groupfix.isolated` and Instagram's own keys |
| 3 | 456 with ours | kept |
| 4 | SideDrop's signer, 456 | kept |
| 5 | ours again | kept |
| 6 | reboot and foreground launch | kept |
| 7 | SideDrop's again | kept |
| 8 | ours on top of the SideDrop-signed IPA (both dylibs) | kept |

Changed at every step: `reinstalls/reinstall_date_last_run_key` and Instagram's session/cache bookkeeping.
`mobileconfig`, `sessionless.data`, `N.*` files and Crashpad locks rotate. The data container's UUID changes at each
install, and the data is kept.

Step 9: RyukGram's own "Mask everything & relaunch" (its floating Device ID button on the sign-in screen; it says it
clears saved logins and cookies). Documents was emptied and the device-ID items were deleted from the keychain.
RyukGram's settings, the planted session items, `Application Support/RyukGram` and `ifizbox.groupfix.isolated`
stayed. So it loses the sign-in but not the settings. RyukGram's "Clear device & relaunch" was NOT run.

Step 10: delete and reinstall 456 (ours). Standard prefs were 0 at the start, the suites and folders were gone, and
the keychain items were all still there in the own group. This is the only step of all that lost settings.

## 1.6.0

- Static strings show "Encrypt" is an optional switch on backups (strings `encryptSwitchChanged`, "Encrypted backup").
- On the phone, 456's first launch added only `ryg_gallery_sealed_v1` and `ryg_gallery_store_migrated_v2`, and no
  keychain key, with an empty gallery.
- `perAccountSettingsKeys` / `profileAccountKeys`: the only per-account names found in the strings are
  `content_filter_per_account` / `content_filter_accounts` and `theme_profile_per_account` / `theme_profile_accounts`
  (word and account lists, and profile colours), not general settings. This is inferred from strings, not observed
  while signed in.

## Suspects

1. **Copy-in.** No loss in these runs; it never overwrites. The mark lives in standard prefs. A cleared mark was not
   tested.
2. **zxPluginsInject's unpinned call before `groupfixInit`.** It reads and updates its own
   `zxPluginsInjectGenericEntry`, with no access group. Every later Instagram genp call logged was pinned to
   `S8NFX3A2LT.com.burbn.instagram`; key-class calls stay group-less. `RyukGram.dylib` made no logged keychain call
   before `groupfixInit`.
3. **Extensions.** Not exercised beyond what iOS launches itself.
4. **Conversion.** No conversion loss seen, but the data was empty.
5. **Reinstall.** Matches "lost settings" (step 10 above).

## Other defects found (filed, not fixed)

These were shown on the phone. They are not this report's cause as far as known. They need an app last signed the
old way (one keychain group, no group fix). SideDrop has signed the fixed way since 2026-11-20. Filed as follow-ups,
not fixed here.

Filing: `run plan add B` for (a) and (b) was refused both times as already open and possibly the same work,
naming B390 itself ("not added: already open, and may be the same work"). No ID was printed for either. Not forced:
the two follow-ups are still to be filed (or added with `run plan note B390`) by whoever takes that decision.

- **(a) Stale shared item.** RyukGram signed the old SideDrop way (keychain only `TEAM.com.ryha.sideload`) while its
  own group holds stale items from an earlier install (the keychain outlives a delete). The app's live session is in
  the shared group. After ours (pre-B327 too, and isolate), reads return the stale own item. The copy-in log reads
  "15 of 15 (15 already there)". The session marker went from `1795462434` to the stale `1795461569`.
- **(b) Legacy folder and suite stay in the wrong place.** Without a fix, zxPluginsInject keeps the original groups'
  folder in a subfolder of a profile group (`<profile group>/group.com.burbn.instagram/`), and their suites in the
  app's own `Library/Preferences` (`group.com.burbn.instagram.plist`). The group fix's first sign then shows an empty
  folder and suite (markers null). The legacy copy also pulled another app's `probe.marker` from
  `group.com.ryha.sideload.1` into RyukGram's suite.

## The launch log

`Library/ifizbox-groupfix.log` in the app's container, plus the system log, one line per launch. Example line from C3:

```
2026-11-23T19:46:12Z com.burbn.instagram 453.0.0 (1099096960) container 84131E3C-...; ran before yes, 73 preferences; application-identifier S8NFX3A2LT.com.ryha.sideload, keychain groups S8NFX3A2LT.com.burbn.instagram, S8NFX3A2LT.com.ryha.sideload; saw passwords S8NFX3A2LT.com.burbn.instagram 16, S8NFX3A2LT.com.ryha.sideload 15; internet none; keys none; isolate S8NFX3A2LT.com.burbn.instagram: copied in generic 15 of 15 (15 already there); pinned yes; app groups 3
```

Verified on the phone: written on the first copy-in, kept through an update with SideDrop's signer in between, and a
second line reads "marked earlier". Read with FLEX's file browser in RyukGram.

Reading it: a log with only new lines means a new container (the app was deleted and reinstalled, or it is another
bundle ID). A long log beside lost settings means the app cleared them itself.

## Phone left

- `com.burbn.instagram` uninstalled (it was not there before).
- Planted items (svce `ryspy.session`, ryspy's and Instagram's device IDs) stay in the keychain in both groups, since
  an uninstall keeps them.

Chromium could not do this: it needs the real keychain, entitlements and installd.

## Slip

One `pgrep -f nothing_matches` was run (no kill), against the run's rules. Harmless.

## Not verified

- A real login.
- The user's own phone, its history, or which IPA or source they installed.
- Before-first-unlock and locked launches, and protected items (the 15 has no passcode).
- Background launch (push or refresh). The reboot step was a foreground launch, so the background launch was not done.
- RyukGram settings set through its own UI.
- Per-account settings with a sign-out and sign-in.
- 1.6.0's conversion of real old data (gallery, deleted messages).
- FLEX.
- "Clear device & relaunch".
- A cleared isolated mark.
- Extensions' keychain calls.
- The live SideDrop server.
- The system-log line (only the file was read).
- Duplicate `com.ryuk.ryukgram`.
- iFizBox's own in-app install flow (signed with `signbench`, the same Swift code).
