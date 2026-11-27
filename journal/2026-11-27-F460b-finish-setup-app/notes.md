# F460b App side: Finish Setup takes the sealed record

## What I did
- `web/app/screens/free-apple-id.js`: `adoptBundledFreeId` takes the key, so it opens a sealed record as well as a
  plain one. `freeIdAtLaunch` shows the Finish Setup alert once per file (storage key `ifizbox.freeid.asked`).
  `finishSetupFromLink` runs the link: it opens the record with the key, imports the certificate and profile with
  `signing.import {bundled: true}`, and shows Setup Finished or Setup Not Finished.
- `web/app/app.js`: runs the launch step after incoming links are taken, so a link tap is never silent (the alert
  follows the link).
- `web/app/incoming.js`: routes `free-id` to `finishSetupFromLink`.
- `web/app/core/storagekeys.js`: `ifizbox.freeid.asked`.
- `native/Sources/SignBridge.swift`: `signing.import` takes `bundled: true` and reuses
  `BundledIdentity.replacesIdentity` and `replacesProfile` through a new `replaceHeld`, shared with the plist path.
  The rules are in Swift because they need data the page does not have.
- `native/sign/Handoff.swift`: `IncomingLink` accepts host `free-id`. Without it the shell dropped the link.
- `native/sign/tests/sideload/main.swift`: a Swift check line for the replacement rules.
- Docs: `docs/signing.md` (After a computer install), `release-notes/F460b.md`.

## Choices made unattended
- The key is not logged. The link trail (`OpenTrail.describe`) omits the fragment.
- The launch alert comes after incoming links are taken, so a tap is never silent.
- The first-launch alert is once per file.
- A certificate the shell keeps still marks the file as asked.

## Tests
- `node --test` for `free-apple-id`, `storagekeys`, `share` and `incoming`: 95 pass.
- The Swift check line is in `native/sign/tests/sideload/main.swift`.

## Not verified
- No real iPhone. Not run: the Keychain import and replacement in `SignBridge`.
- The `ifizbox://free-id#<key>` link opening the app from Safari.
- `app.openURL` opening ifizbox.com in Safari. This needs a phone with a sealed IPA from a real computer install
  with an Apple ID.
- The launch alert, not seen in Chromium or on a phone. The wiring in `app.js` has no test.
