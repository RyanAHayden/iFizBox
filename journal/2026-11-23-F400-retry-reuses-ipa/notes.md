# F400: a retry reuses the IPA already downloaded

## What I built
- `WaitingIPA` (`native/sign/OriginalIPA.swift`): an IPA that finished downloading is kept unsigned, whole, as `<key>.ipa` with a `<key>.json` note in the app's Caches (`com.ryha.ifizbox/waiting`), keyed by the URL's hash. One per app (the IPA's own bundle ID). The note is written last, so a file without one is swept, never used.
- `IPAFetch` (`native/Sources/IPAFetch.swift`) is the one way an install gets its IPA from a URL: the kept one if it may be used, else a download (`Sideload.download`) that is then kept. `signing.install`, `signing.prepare`, `signing.inspect` and Re-sign use `run()`. The jailbreak app's `ipa.install` has its own download and calls `waiting()`.
- Before a kept IPA is used, `IPAHead` sends a HEAD (5 s). An ETag, Last-Modified or length that says another file means the download happens again. Offline or no answer, the kept file is used.
- The page's `listed` (version and size the source lists) is passed in as a parameter and checked against what was listed at download time.
- Hard link in `Caches/com.ryha.ifizbox/waiting` for the iFizBox app. The jailbreak app gets a copy, because the helper refuses an IPA with two names.
- Removed on: a successful install of that same file (SHA-256), `signing.forget`, the jailbreak app's uninstall (`remove(app:)`), a known-malware hash, the signer's `bad_ipa` or `bad_macho` (not `bad_macho` with injected tweaks), a helper exit 64 only when the file really doesn't read, or a zip failure that isn't a write error. Over 7 days old or incomplete, it goes at launch and whenever another file is kept. The app's own update is removed at launch once it runs.
- Tests: `native/sign/tests/sideload/main.swift` and `web/app/core/f400-listed.test.js`.

## Decisions
- "encrypted" is not treated as damaged: the file is whole, and a fresh download gives the same file, so keeping it loses nothing.
- On the Signing Server route, iOS 27 can't confirm an install (`apps.isInstalled` is nil there), so the kept IPA stays until it expires. It takes no extra space: Re-sign's kept IPA is the same inode.
- There is no "clear caches" button in the app. Delete (Remove from List) calls `signing.forget`; the jailbreak app's uninstall removes the rest.
- A size the source lists is compared with the size listed at download time, not the current one, because listed sizes are often wrong.
- `library.add` downloads are not kept; they go through their own path and are untouched.

## Phone check
Not run. The lock was held by F389, then B392 (15:25-16:00), so the phone was never free for this build. One wait loop was stopped by the system for low memory, and a single attempt later found the phone locked again.

`phone.mjs` is beside these notes. Its argument is a scratch dir; it needs the F400 build via `tools/ui-15.sh install`, and its ui lock name (F400) must be changed to the follow-up's own ID. The follow-up is R85: the iPhone 15 Pro run, plus the iPhone 7 part (`ipa.install` failing, then retried).

## Not verified
Everything on a real phone: the HEAD against GitHub, hard links in Caches, retry, corrupt, kill, the This iPhone success removal, and the jailbreak `ipa.install`. Covered on Linux instead: `native/sign/tests/sideload`, the web tests, and both builds compiling.

## Spec review
- Fixed: a helper exit 64 only drops the file when it really doesn't read (`WaitingIPA.sound`).
- Fixed: `bad_macho` with injected tweaks doesn't drop the file.
- Fixed: an install only drops the waiting IPA when it is the same one (SHA-256).
- Fixed: Re-sign's "iOS fetched it" doesn't count as installed.
- Fixed: `listed` is sent from browse's Install and the Custom Install look.
- Fixed: expired files also go whenever another is kept.
- Kept: `signing.inspect` uses the same fetch, because `signing.install`'s token installs that download.
