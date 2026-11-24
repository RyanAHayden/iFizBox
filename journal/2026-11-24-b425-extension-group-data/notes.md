# B425: the group fix gives RyukGram's notification extension the app's group data

R95 did not disprove the group fix: it ruled the keychain out and found the app's and extension's group data in different places (likely cause, not shown). So this was built.

## Design
- An extension can't reach the app's container. The app's own place stays the master (nothing moves, so nothing can be lost); it puts a one-way copy of suites and small files in the profile's group, and the extension brings it into its own container. Details: docs/signing.md.
- Not chosen: moving the master into the profile group (lost with another profile's groups); copying into zxPluginsInject's folder (B426's wording; apps naming the same original group would share it).
- Both signers load the dylib in the notification service extension (rpath ../../Frameworks).
- Keychain: in the extension the names of original groups are stripped and passwords pinned as the app's are.

## Measured on the iPhone 15 Pro (Instagram 456 + RyukGram, SideDrop identity; spy.m; step.sh; report-first-run.txt)
- The app starts its own notification extension with NSExtension's extensionWithIdentifier: + beginExtensionRequest (private; LiveContainer's way). This works where R95's launches failed. The real extension process ran.
- It read all 363 + 8 + 1 suite keys equal to the app's through initWithSuiteName (auth device storage, device ID and install date there), and got the 64 + 1 + 1 files. Passwords asked for in MH9GU9K5PX.platformFamily and .shared: 38, the hpke key among them, pinned.
- Second start: 1 new key + 1 in the family suite, 13 files: only what changed.
- Update from the earlier fix: container birth time, 1180 preferences, 44 + 18 passwords the same before and after; Library/AppGroups kept (86 files).

## Found: Instagram is signed out on the phone
- After installing this build Instagram showed its saved-profile "Continue" screen. No screenshot was taken before the install, so this is not proven to be older.
- Points to older: the group fix log's password count for S8NFX3A2LT.com.burbn.instagram fell from 46 to 44 between its 17:46Z launch and its 17:59Z one, during R95's runs without the group fix (R95 took no screenshots and reports "no sign-out seen"); it was still 44 at this build's first launch (counted before anything else runs) and after. That does not prove which items went.
- So "stays signed in through the update" is NOT shown. "Continue" was not tapped: it is the owner's personal account.

## Left to do (for the session that reopens this)
1. Screenshot that Instagram is signed in. 2. Install a build with main's dylib, screenshot; then this branch's, screenshot: signed in, RyukGram settings kept. 3. If it signs out: find why before landing. 4. Run `done`. IPA: SideDrop /data/apps/com.burbn.instagram.ipa, sha256 c773aac1…; sign with R89's sign.sh.

## Not verified
- Staying signed in (above), and RyukGram's settings beyond the key count (the two plist pulls had the same size and time, so the app had not written them yet).
- A real push: whether its text now shows. B426's owner check stays open.
- shareOut/shareIn/updateFiles have no host tests (Objective-C on iOS only); measured on the phone as above. Not run there: a fresh install over a leftover copy, another profile's groups, before first unlock, an app with `target`, an iFizBox website-signed copy (tests only).
- YouMod's notifications with this build.
- Settings both sides changed take the app's value (no times on settings); extension writes don't return to the app.
- Phone left with this branch's dylib and no probe; Library/b425.txt and ifizbox.shared/com.burbn.instagram/spy.txt remain.

Review: fixed seeding before first unlock, cleared suites, saved pin, signers' folder rule, service extension only.
