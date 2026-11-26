# F444: Free Apple ID in the sideload app

## What I did
- signingLayout: `free` group for mode sideload when there is no certificate or a Free Apple ID is kept (`freeKept`, read from localStorage `ifizbox.freeid`); jailbreak never; "free" added to the Certificate page's parts.
- free-apple-id.js: `freeRouteBlock({ native })` shows at once in the app (no /apple/status check); `nativeTransport` over net.request; `directWsUrl` for the anisette WebSocket; UDID from device.info; Ready imports via signing.import (`importParams`, `keepInApp`); app wording of footers (`APP_FOOTERS`); Forget removes the Keychain identity only when the serial matches (`sameSerial`).
- native/Sources/Paid.swift: net.request also takes PUT (gsa.js sends the SMS code request as PUT).
- Tests: settings.test.js layout asserts (sideload includes free with no certificate or freeKept, jailbreak never for any state); free-apple-id.test.js: transport, WebSocket URL, import params, serial match, app footers, the storage key shared with settings.js.

## Checks
- node --test on both test files: pass (40 tests).
- Chromium, fake bridge, sideload mode, #/settings/signing/certificate: the Free Apple ID group shows with the app footer; Sign In shows the app password footer; with net.request forwarded to a Node proxy (NODE_EXTRA_CA_CERTS = the rig's ca-bundle.pem, since gsa.apple.com chains to Apple Root CA which Node lacks; iOS trusts it), the whole pre-login chain answered: anisette client_info, provisioning over the direct WebSocket to new.ani.sidestore.io (the first two servers closed early, as they do for the website), get_headers, GsService2 lookup and SRP init (Apple answered error -1 for the dummy example.com address, as expected).
- Jailbreak mode: no Free Apple ID group. Sideload with a kept free identity: Ready shows no Save for the App and no computer install; Refresh/Sign In Again, Developer Mode and Trust, Forget, Done.

## Tried and failed
- First live run: Node's fetch refused gsa.apple.com (SELF_SIGNED_CERT_IN_CHAIN, Apple Root CA); fixed in the stand-in with the rig's CA bundle. Not an app issue: URLSession on iOS trusts Apple Root CA.

## Not verified
- A real sign-in, 2FA, setup and Ready on the iPhone 15 Pro: no free Apple ID login exists on this machine (same one T87a waits for).
- That WKWebView's WebSocket to the anisette server is accepted from the app's origin (Chromium's from http://127.0.0.1 was).
- That the native signer's apps install with a free development profile on a phone. After the spec review, the signer
  keeps get-task-allow as the profile allows under Xcode team profiles (`isTeamProfile`: Name "iOS Team Provisioning
  Profile…" or LocalProvision; R32 found false gives "integrity could not be verified"); checked only by
  native/sign/tests/main.swift with hand-made profile plists. The Name is what R30 saw on a real free
  profile (journal/2026-11-19-r30-free-apple-id/notes.md).
  B468 (filed for this) was dropped.
- Spec review also fixed: the group's "certificate in use is the Free Apple ID's" now compares serials (`freeInUse`),
  not just "a Free Apple ID is stored".
- Keep Bundle IDs on with a free explicit profile (apps keep their own IDs under the app's App ID): untried on a device.
- The certificate the app makes is still named "<NAME> Website" in Apple's list (MACHINE_NAME); cosmetic.
