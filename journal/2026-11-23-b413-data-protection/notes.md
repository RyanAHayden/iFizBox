# B413: data protection on signed apps

## What I did
- Both signers leave `com.apple.developer.default-data-protection` out of an app's signed entitlements unless the app's original signature had exactly the profile's value. The app's signer (native/sign/Profile.swift `entitlements(for:…dataProtection:)` and `originalDataProtection`, native/sign/IPASigner.swift) judges each extension by its own executable. The website's signer (web/app/core/websign.js `appEntitlements` and `originalDataProtection`, web/app/websign-job.js) takes app extensions out before signing, so only the app matters there.
- Result: with a Complete profile, UntilFirstUserAuthentication is left out, which is iOS's default class anyway.
- An executable signed here before (for example with the group fix config in the app), or under the profile's own team, carries the profile's value, so it counts as having no original value.
- Cost: an app that really asked for Complete (Signal, say), re-signed from an already signed IPA, or a developer's own app under their own team, gets iOS's default class instead. I chose the safe side, since the app always opens its files. An IPA signed earlier under another team with no config (by another signer, or here when no group fix went in) cannot be told apart from an original and keeps its value.
- SignerStamp and WEB_SIGNER_VERSION go from 2 to 3, so installed apps are listed under Needs Re-sign.
- A message mid-run moved the website files from groupfix.js to websign.js, where the entitlements are built; the plan line still lists groupfix.js.

## Tests
- web/app/core/websign.test.js and native/sign/tests/main.swift, "B413: data protection" (none, UntilFirstUserAuthentication, Complete; app and extension; signed before).
- web/app/b413-data-protection.test.js: the website's whole sign job.
- native/test_sign.py and the node tests pass.

## Not verified
- On a real phone, that a background launch while locked reads its preferences. That needs an all-capabilities-signed install and a locked phone. The effect follows from the entitlement, checked in the signed output.
- Whether installed apps' protected folders stay Complete after a re-sign: the follow-up research is R86.

## Spec review
- It noted that a re-sign from a signed IPA loses Complete: accepted, the original value is not known for IPAs signed before this, and leaving it out never locks an app out of its files.
