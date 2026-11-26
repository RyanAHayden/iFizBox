# B478: a carried certificate that Apple no longer has

## Goal
R103 saw Sign In Again in the Free Apple ID app (`com.ryha.ifizbox.4549VNVVAG`, iFizBox 1.0.4) hit the Certificate
Limit alert after a computer setup, instead of reusing the certificate the computer install carried. The first guess was
a serial format mismatch in `web/app/core/freeroute.js` `certificate()`. B478 checks that and fixes what is wrong.

## Finding
No check in `freeroute.js` fails. Over Web Inspector on the iPhone 15 Pro, with a hook on `DevPortal.listCerts` in the
running app:
- The carried record's serial was `4C360FE9E6BBFB4A1A85343A04F5737E`.
- Apple listed only iloader (`1DB66FCB691D83B7381B49ED44436864`) and "iFizBox Website"
  (`15B426F367568B16261AB18614BBC528`).
- Apple's `serialNumber` equals `certSerial()` of its `certContent` exactly (upper-case hex).

So the carried certificate was not at Apple any more. The Certificate Limit alert was the right answer: a new
certificate was needed.

Why it was gone: T87a's website run made `4C36…` in Safari (about 14:55). F445, filming on the paid Lite copy with the
same spare Apple ID (15:04-15:08), revoked "iFizBox Website" (`4C36…`) and made `15B4…`. R103's computer setup at 17:48
then carried Safari's stale `4C36…` record.

Lesson for later phone tests: tasks that share the spare Apple ID revoke each other's "iFizBox Website" certificate.
Check Apple's list before blaming the code.

## What I did on the iPhone 15 Pro
- The brief's check, done for real at about 18:00-18:07. In Safari, ifizbox.com Settings > Signing > Sign In Again. The
  website hit the limit too, since its `4C36…` was dead. I revoked "iFizBox Website" (`15B4…`, F445's leftover), the same
  choice T87a and F445 made, and left iloader alone. It made `6C7616E225E00F9FE1C829B32D10CDBA`.
- Downloaded the Computer Install and ran `curl -fsSL https://ifizbox.com/sign/setup.sh | sh -s -- CODE` from the Linux
  desktop. It installed iFizBox 1.0.4 and the pairing file.
- Second bug, found then: the reinstalled app's Keychain still held the old `4C36…` identity, while its bundled
  `web/free-id.json` carried `6C76…`. `adoptBundledFreeId` refused the record (serial mismatch), so the old record stayed.
  Native `importBundled` (`native/Sources/SignBridge.swift`, `BundledIdentity.shouldImport` in
  `native/sign/Handoff.swift`) imports only when the Keychain holds no identity. `refreshBundledProfile` then marks the
  new file as seen, so it never imports later either. Filed as a follow-up (below).
- To finish the check as a first-time computer setup would run: `signing.remove` over the bridge, then `signing.import`
  with the bundled `free-id.json`'s p12, profile and password (the call the app's Ready step makes), then relaunch.
  `ifizbox.freeid` was adopted with `6C76…`.
- Settings > Installation & Signing > Certificate > Free Apple ID > Sign In Again. Sign-in took no 2FA prompt this time.
  The checklist said "Already on the account". The Certificate row said "Reused this browser's certificate" (until
  2027-11-26). App ID was already made, and the profile was until 2026-12-03. No Certificate Limit alert.
- Refresh Profile then ran the checklist again and reused the certificate again.
- Apple's list after: iloader and `6C76…` "iFizBox Website", both issued.

## Code change
None in `web/app/core/freeroute.js`. Two regression tests in `web/app/core/freeroute.test.js`:
- A carried certificate that Apple lists as issued is reused, with no alert and no new CSR.
- A carried certificate revoked elsewhere (not listed) is not reused. At the limit, Cancel revokes nothing.

`node --test web/app/core/freeroute.test.js`: 17 pass.

## Follow-ups filed
- B479 (`B`): a second computer install with a new Free Apple ID certificate keeps the old Keychain identity
  (`importBundled` / `refreshBundledProfile`; `native/sign/Handoff.swift`, `native/Sources/SignBridge.swift`).
- B480 (`B`): the Certificate Limit alert lists iloader's certificate above "iFizBox Website". `otherTool()` in
  `freeroute.js` does not know iloader.
- B481 (`low`): the sideload app's checklist says "Reused this browser's certificate", but the record came from the app
  or a computer install, not a browser.

## Tried and failed
- A first fix compared serials as numbers (leading zeros, case) and also read `certContent`. Reverted: the phone showed
  the serials already matched.
- `tools/ui-15.sh` tidy, then launch, left the screen off once. A wake was needed first.
- The first `pymobiledevice3` CDP server stopped answering after the app relaunched. A new one on another port worked.

## Not verified
- Home's tile days right after a fresh profile. The profile date did not change, because the refreshed profile has the
  same expiry day (2026-12-03).
- A real first-time computer setup on a phone with no earlier copy. `signing.remove` plus `signing.import` stood in for it.
- The paid Lite copy was not opened. Revoking a free team certificate does not touch its own paid identity.
