# F436: computer install on the free route's Ready page

## What
- `web/app/screens/computer-install.js` (new): the block on the Ready page of the free Apple ID route. Download for a
  Computer Install signs the newest release's IPA with the free identity (`runSignJob` with `free`), uploads it
  (`/sign/upload`), and `POST /sign/setup` makes the code. The code shows until it expires, with the two one-liners
  from docs/sideload.md; Make a New Code re-uploads the same signed IPA; Save the IPA is the fallback.
- `web/app/websign-job.js`: `free` option; the entitlements are `freeEntitlements` (core/freeroute.js) instead of the
  certificate route's.
- `web/app/core/freeroute.js`: `freeEntitlements` narrows a `TEAM.*` keychain group to the app's own.
- `web/app/screens/free-apple-id.js`: the block on Ready; a new profile and Forget drop the signed IPA and code.
- Docs: docs/signing.md (Free Apple ID: the block, the rules, the tests), docs/sideload.md (the computer setup's
  not-verified bullet: the website side is built now). Release note `release-notes/F436.md`.
- Tests: `screens/computer-install.test.js`, `websign-free.test.js`, `core/freeroute.test.js` (the keychain narrowing, and a group that doesn't cover the app kept as is).

## Decisions
- Own module, `computer-install.js`, not more code in free-apple-id.js.
- Keychain group narrowed: native `OwnKeychain.pick` looks for `TEAM.<bundleID>` literally, so the profile's
  `TEAM.*` group would leave the app without its own group.
- Token read from the upload answer's manifest URL, so `signing/browser.js` is untouched.
- Plain one-liners as documented: the command asks for the code itself (`sh -s -- ABCD-2345` gives it in advance).
- Re-upload for a new code: a code lives as long as its upload, so a new code needs a new upload.

## Checked
- Node tests, including the real Worker (KV in memory) and the real zsign WebAssembly.
- Chromium run (`chromium.mjs`: local site, the real Worker, a fixture certificate, a tiny IPA, clock set before the
  profile ends). Shots: `1-ready.png`, `3-code.png`, `1-expired.png`.

## Not verified
- A real free identity signing.
- An install on an iPhone over USB, the app opening and importing the identity, and the pairing file being read.
  Nothing in native reads Documents/pairingFile.plist: Sideload and IDevice take a pairing file through import.
- The one-liners themselves: no `setup` release is published yet, so they 404 until R38's release.
- Safari and iOS rendering, and Save the IPA's file name there.
- All style eras but iOS 6 (light shot only).
- R38 covers the real run.
