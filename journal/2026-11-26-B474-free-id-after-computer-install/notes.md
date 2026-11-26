# B474: Free Apple ID after a computer install

## Problem
After a computer setup, the sideload app had the free identity in its Keychain (imported from `ifizbox-identity.plist`,
native BundledIdentity) but nothing under localStorage `ifizbox.freeid`. So settings.js `freeInUse` was false and
`signingLayout` hid the `free` group (it shows with a certificate only when that certificate is the Free Apple ID's).
No Refresh Profile and no Sign In Again; Home's expiry tile went to Settings > Signing with nothing to renew there.

## What I did
- computer-install.js passes `record` (free-apple-id.js `freeRecord(saved)`, the same JSON `saveFreeIdentity` keeps)
  into the sign job as `bring.freeId`.
- websign-job.js writes it as `web/free-id.json` (core/websign.js `FREE_ID_FILE`), only for iFizBox's own IPA with
  `bring.identity`.
- app.js, on each native launch, fetches `free-id.json`; only if it exists does it load free-apple-id.js and call
  `adoptBundledFreeId`. That needs the bridge, a `signing.status` identity whose serial equals the record's
  (`sameSerial`), and a marker `ifizbox.freeid.bundled` (serial + profile tail), so the file is taken once.
- In a fresh app session there is no portal, so the Ready page's button is Sign In Again. After sign-in, setup reuses
  the carried certificate (same team, p12 + serial): no new certificate and no Certificate Limit prompt. It makes a new
  profile, which Ready imports into the Keychain.
- docs/signing.md: a bullet under "In the sideload app" for the computer install's record; the computer-install
  paragraph mentions `web/free-id.json`.
- release-notes/B474.md: one user-facing sentence.

## Days
core/signing.js `expiryWarning` counted `Math.floor(left / DAY)`, so a 7-day profile a few minutes old gave 6. Now
`floor((left + 1 hour) / DAY)` (`EXPIRY_GRACE`). The existing tests (6.5 days -> 6, 1.5 -> Tomorrow, 0.25 -> Today) are
unchanged. A profile made more than an hour before the app first shows it still reads 6 days, which is true whole days.
The spec review pointed out that the grace also rounded 23.5 hours up to Tomorrow, so it now applies only from 2 whole
days up: Today and Tomorrow stay exact. Using the profile's CreationDate instead would need signing.status to report it
(native SignBridge.swift); not worth a native change here.

## From the spec review, left as is
- The record is taken in the background at launch and nothing redraws afterwards. Home's tile doesn't depend on it, and
  Settings draws fresh when opened, so only a Settings page already open in the first second would miss the group.
- In a new app session there is no Apple session, so the button is Sign In Again, not Refresh Profile. After the
  sign-in, setup makes the new profile and imports it, which is the refresh.

## Tests
- screens/free-apple-id.test.js (adopt): same serial -> taken and the group in the layout; once per file, even after
  Forget; other serial / no file / bad JSON / no bridge / signer error -> nothing; 7 days.
- screens/computer-install.test.js: `bring.freeId`.
- websign-job.test.js: `web/free-id.json` only for iFizBox with the identity.

## Security
The file holds the same .p12 and password that `ifizbox-identity.plist` already holds in the same bundle. No new exposure.

## Not verified
- **Not verified**: the check on the iPhone 15 Pro after a real computer setup (the group shows, Refresh Profile makes a
  new profile, the tile's Renew opens it, the days match). It needs the website with this change deployed (the setup
  command downloads the IPA signed on ifizbox.com and signs it in the browser there) and a sign-in with the spare free
  Apple ID. Neither can happen before this branch is merged and published. Filed as a follow-up check that waits for
  this task.
- Not checked in Chromium either: the group's layout decision (signingLayout + freeInUse) and the adopt are covered by
  node tests; the Ready page itself is unchanged.

Follow-up: R103 (the iPhone 15 Pro check after a real computer setup, once the website has this change).
