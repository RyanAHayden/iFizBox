# R45 on the iPhone 15 Pro: Buy row and signed-in betterAlarm download

Run on the iPhone 15 Pro (iOS 27.0.1) on 2026-11-24, through `tools/ui-15.sh` under its lock. The sideload IPA was built
from main with `make -C native ipa` (0.31.0 (5441)) and installed with `ui-15.sh install`. The owner has been signed in
to Chariz since 2026-11-23. Earlier run: journal/2026-11-21-r45-iphone15-chariz.

## What I did

1. Opened Glint (com.antonym.glint, $3.99) with `ifizbox://package?id=com.antonym.glint` and read its package page.
2. Opened betterAlarm (com.noisyflake.betteralarm 1.4.1, labelled Paid, priced FREE) and read its Add to an App group.
3. Called the shipped `createPaidTweaks().deb({package, version: "1.4.1"})` through Web Inspector
   (`pymobiledevice3 webinspector cdp`), with a wrapper that logs bridge calls and hides `paid.cached`.
4. Browsed Chariz's source list, then restored every source filter to its default.

## Findings

1. **Buy row.** Glint's Add to an App group shows `Price $3.99`, then `Buy for $3.99 ›`. The footer reads "Sold by
   Chariz. Once bought, it goes into an app you sign here." There is no Sign In row, which reads as the signed-in state.
   I did not tap Buy, so no purchase was made and the post-Buy state is unseen.
2. **betterAlarm can't go into an app.** Its Add to an App group reads "Can't Go into an App": "It's for iOS itself
   (SpringBoard or a system app), not an app you can sign." This is expected for a system tweak, which is not injected.
3. **Signed-in download works end to end.** The logged calls, in order:
   - `paid.cached` (hidden), `device.info`, `keychain.get` (the Chariz credential is present).
   - POST `chariz.com/api/sileo/package/com.noisyflake.betteralarm/info` returned 200 with price FREE, purchased true,
     available true.
   - `device.info`, `keychain.get`, then POST `.../authorize_download` with the udid, device, version 1.4.1, repo, and
     architecture iphoneos-arm64. It returned 200 with a one-time URL on the Chariz object-storage host.
   - `paid.download` took 366 ms and produced a .deb of 295154 bytes starting `!<arch>`.
4. **Why it took a detour.** Chariz's source page lists 0 packages with the defaults. Source Filters "App Tweaks Only"
   drops rootful-only tweaks, and the page then says "No app tweaks: this is a jailbreak source". betterAlarm and Glint
   are reachable only through `ifizbox://package?id=`. The "Works on My Phone" switch on a source's page is the All
   Sources switch, not Chariz's alone. I turned it off and turned App Tweaks Only off for Chariz to browse. Only five
   free packages showed: PleaseDontStopTheMusic, Return YouTube Dislike, Return YouTube Music Dislike, Sunflower and
   YouGroupSettings.
5. **Filters restored.** Verified in Manage > Filters: Chariz is "Same as All Sources". All Sources has Works on My
   Phone, Hide Old, App Tweaks Only and Newest Copy on, which are the defaults.

## Tried and failed

- Browsing the Chariz source list for betterAlarm. It was empty with the defaults.
- A `sleep 25 &&` chained command was refused by the harness.

## Not verified

- The end-to-end paid inject. betterAlarm and Glint cannot be injected, and no paid tweak was bought, per the brief.
- Tapping Buy and the state after it.
- The kept .deb in Application Support/PaidTweaks, written on this run. It was not read back from the container. The
  earlier run (journal/2026-11-21-r45-iphone15-chariz) did see it.
- The Sign In flow itself. The owner was already signed in.
- The Chariz credential is read from the Keychain and is present, but its owner and account were not inspected.
