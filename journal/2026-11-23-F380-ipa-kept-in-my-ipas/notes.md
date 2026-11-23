# F380: a custom IPA install keeps its download in My IPAs

## What was done

- Before: a Custom Install, a URL or a link saved the IPA into My IPAs (F379) by downloading it a second time after
  the install (`library.add {url}`). Now the install's own download is kept.
- `native/sign/KeptDownload.swift` (new): `IPALibrary.hold(download, in:dir, token:)` gives the download a second name,
  `<token>-mine.ipa` (hard link, else copy); `IPALibrary.downloadName(url, details:)` names it as `library.add` would
  (the link's name if it ends in .ipa, else "<app name> <version>.ipa"); `IPALibrary.keep(held, url:)` moves the held
  file into My IPAs, after Inspect.ipa (a non-IPA throws).
- `native/Sources/SignAhead.swift`: `signing.prepare {url, keepInLibrary: true}` holds the download before the signer
  deletes it. Only for a url download, not a Re-sign record, not a My IPAs file, not iFizBox itself. The Kept entry
  carries `mine`; `signing.open` moves it into My IPAs (`MyIPAs.keepDownload`) once it has gone through, and its reply
  adds `libraryFile`. Discard, forget after 30 min, a failed sign, and a cancelled or failed open delete the held file.
  B337's This iPhone spare keeps it for the Signing Server Fallback.
- `native/Sources/MyIPAs.swift`: `wantsKeep(c)` and `keepDownload(held, url:, log:)` (logs "Saved the IPA in My IPAs as …,
  no second download").
- `native/Sources/Apt.swift`: jailbreak `ipa.install {keepInLibrary: true}` moves its download into My IPAs after
  ifizbox-helper has installed it (instead of deleting it) and replies `libraryFile`.
- `web/app/core/myipas.js`: `saveInstalledIpa` takes `file` (or the file `noteKeptIpa(url, file)` remembered, taken once
  by `takeKeptIpa`) and uses it instead of `library.add`. A kept file of an app already saved at that version is deleted
  again; a kept file that is gone falls back to `library.add`.
- `web/app/signing/queue.js`: `prepareOnDevice` sends `keepInLibrary` for a Custom Install (`customInstallSave(job)`
  non-null); `openPrepared` notes signing.open's `libraryFile`.
- Jailbreak: `web/app/ipa-install.js` (`installIpa`/`runIpaInstall`) take `keep`; `screens/ipa-install.js`
  (`installWithAppSync`, `runIpaConsole`) pass it, not through share.js's staged-file stand-in. Install from URL, a tapped
  .ipa link and `incoming.js`'s ifizbox://install pass `keep: true`; `saveIpaCopy` passes `r.libraryFile`.
- Tests: Swift test "F380: a custom install's download lands in My IPAs without a second download" in
  `native/sign/tests/main.swift`; JS `web/app/screens/myipas-kept.test.js`.
- Swift sign tests: `python3 -m unittest native/test_sign.py` passed (4 tests, the Swift binary's "all passed", the F380 test among them); node tests of myipas-kept, myipas-autosave and signing-client-sent passed.

## What was tried and decided

- On the sideload app the IPA moves into My IPAs when signing.open goes through (the prompt opened, or This iPhone
  installed), not when iOS confirms the install. An install whose iOS prompt is then cancelled still leaves the IPA in
  My IPAs. Accepted: the user chose to install it and can install it again from there.
- The jailbreak app's queue (AltStore installs through helperLanes) and AltStore page installs send no
  `keepInLibrary`: they never saved to My IPAs.
- Apt.swift does not hard-link: the helper refuses an IPA with more than one link (`native/helper/ipa.c`
  st_nlink != 1) and installs from its own copy, so the file is moved afterwards.

## Not verified

- The shell parts (SignAhead, MyIPAs and Apt hooks) can't run off the phone; they are checked only by the native builds
  in `tools/check.sh`.
- Not run on the iPhone 15 Pro (sideload) or the iPhone 7 (jailbreak). The logic that runs off the phone is covered by
  the Swift and node tests. A phone run would only confirm the hard link and the move inside the app container (same
  volume); the Swift test does that on Linux.
