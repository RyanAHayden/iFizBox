# F400: a retry reuses the IPA already downloaded

## What I built
- `WaitingIPA` (`native/sign/OriginalIPA.swift`): an IPA that finished downloading is kept unsigned, whole, as `<key>.ipa` with a `<key>.json` note in the app's Caches (`com.ryha.ifizbox/waiting`), keyed by the URL's hash. One per app (the IPA's own bundle ID). The note is written last, so a file without one is swept, never used.
- `IPAFetch` (`native/Sources/IPAFetch.swift`) is the one way an install gets its IPA from a URL: the kept one if it may be used, else a download (`Sideload.download`) that is then kept. `signing.install`, `signing.prepare`, `signing.inspect` and Re-sign use `run()`. The jailbreak app's `ipa.install` has its own download and calls `waiting()`.
- Before a kept IPA is used, `IPAHead` sends a HEAD (5 s). An ETag, Last-Modified or length that says another file means the download happens again. Offline or no answer, the kept file is used.
- The page's `listed` (version and size the source lists) is passed in as a parameter and checked against what was listed at download time.
- Hard link in `Caches/com.ryha.ifizbox/waiting` for the iFizBox app. The jailbreak app gets a copy, because the helper refuses an IPA with two names.
- Removed on: a successful install, `signing.forget`, the jailbreak app's uninstall (`remove(app:)`), a known-malware hash, the signer's `bad_ipa`/`bad_macho` (or a zip failure that isn't a write error), after 7 days, or at launch when it is incomplete. The app's own update is removed at launch once it runs.
- Tests: `native/sign/tests/sideload/main.swift` and `web/app/core/f400-listed.test.js`.

## Decisions
- "encrypted" is not treated as damaged: the file is whole, and a fresh download gives the same file, so keeping it loses nothing.
- On the Signing Server route, iOS 27 can't confirm an install (`apps.isInstalled` is nil there), so the kept IPA stays until it expires. It takes no extra space: Re-sign's kept IPA is the same inode.
- There is no "clear caches" button in the app. Delete (Remove from List) calls `signing.forget`; the jailbreak app's uninstall removes the rest.
- A size the source lists is compared with the size listed at download time, not the current one, because listed sizes are often wrong.
- `library.add` downloads are not kept; they go through their own path and are untouched.

## Phone check
TODO

## Not verified
TODO
