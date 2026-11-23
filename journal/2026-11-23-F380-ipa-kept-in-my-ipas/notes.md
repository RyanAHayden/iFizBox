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
  installed), not when iOS confirms the install. If the iOS prompt is dismissed (signing.progress closed), the row drops
  the kept IPA again. Only an install that ends unknown (Sent to iOS) keeps it.
- The jailbreak app's queue (AltStore installs through helperLanes) and AltStore page installs send no
  `keepInLibrary`: they never saved to My IPAs.
- Apt.swift does not hard-link: the helper refuses an IPA with more than one link (`native/helper/ipa.c`
  st_nlink != 1) and installs from its own copy, so the file is moved afterwards.

## Spec review

- Fixed: a row whose iOS prompt was cancelled now drops the kept IPA. `signing/queue.js` `openPrepared` calls
  `library.delete` on signing.open's `libraryFile` and forgets it (test in `web/app/screens/myipas-kept.test.js`).
- Fixed: new `native/test_kept_download.py` reads `SignAhead.swift` and `Apt.swift` for the wiring: prepare holds the url
  download before signing (not for a Re-sign); open moves it and replies `libraryFile`; failure and forget delete it;
  `ipa.install` moves after the helper, never a hard link. The shell can't run off the phone, so this is the check.
  The Swift test covers `IPALibrary.hold` and `keep`.
- Kept as is: `signing.install` (`Sideload.swift`) gets no `keepInLibrary`. No Custom Install that saves to My IPAs goes
  through it: the sideload queue uses signing.prepare/open, and F379's saves come from the queue and the jailbreak's
  `ipa.install`. So `Sideload.swift` is unchanged.
- Kept as is: a tapped .ipa link and `ifizbox://install` pass `keep` too. They already saved via `library.add`
  (F379's `rememberIpa`), so this only removes their second download.
- Kept as is: `runIpaConsole` sends `keep` only without a `native` stand-in. The only stand-in is share.js's staged file,
  which has no download.
- Kept as is: the url-keyed `noteKeptIpa` map. A leftover entry is checked against `library.list` before use, so at worst
  a save reuses an IPA of the same link.

## Not verified

- The shell parts (SignAhead, MyIPAs and Apt hooks) can't run off the phone; they are checked only by the native builds
  in `tools/check.sh`.
- Not run on the iPhone 15 Pro (sideload) or the iPhone 7 (jailbreak). The logic that runs off the phone is covered by
  the Swift and node tests. A phone run would only confirm the hard link and the move inside the app container (same
  volume); the Swift test does that on Linux.
