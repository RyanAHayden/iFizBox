# B505: the signing sheet on a free Apple ID's profile sends no Keep Bundle ID

## What I did
- `web/app/signing-sheet.js`: when `signing.inspect` says `pinned: true`, the sheet's edits have no `keepBundleId`
  key at all. Before, it hid the switch but still sent `keepBundleId: false`, which could be saved with the queued
  job or the IPA's Sign Options and then apply under another profile. The pre-filled bundle ID is still inspect's
  `signsAs`.
- The Install As footer on a pinned profile now reads "Change the name on the Home Screen or the icon (made 180×180).
  Your profile signs it as <ID>." The "to install a second copy" wording is left out there, because a typed bundle ID
  uses a kept profile only if one exists (`docs/signing.md` "Per-app profiles"). The Bundle ID field is unchanged and
  still editable. Other profiles keep the old footer.
- `web/app/signing-sheet.test.js`: extended with the pinned case (no key sent, footer text) using a fake document.
- The global Keep Bundle IDs "off" that the job runner adds is unchanged; it does not come from the sheet.

## Checks
- `node --test` on `web/app/signing-sheet.test.js` and `signing-client-insecure.test.js`: 22/22 passed.

## Not verified
- Nothing run on a phone or in Chromium; the check is text and params only.
- Keep Bundle ID values already saved by earlier builds are not cleared.
