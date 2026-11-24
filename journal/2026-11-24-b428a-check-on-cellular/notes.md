# B428a: checks on cellular

On cellular without Wi-Fi, iOS refuses This iPhone's connects, so the checks that the user asks for no longer connect.

## What was done

- **Web** (core/installroute.js, screens/installroute.js): Check Connection, Fix, Test Connection, Set Up's test after
  pairing, and Pairing's recheck read `idevice.status` first. On cellular they show the alert "Can't Check on Cellular"
  ("Join Wi-Fi, then check again.", OK; " Test Connection finishes setting up." while the built-in VPN isn't tested).
  No Fix, no Pair Again, nothing kept as a Route Failure, no pairing forgotten; a Route Failure kept earlier stays.
  Automatic checks are silent. A check that was refused (`route_refused`, `refused`, `connect_failed` with "connection
  refused") reads the status again, and on cellular says the same. The Quiet Pairing Check's retry that ends on cellular
  keeps nothing. Install failures are unchanged.
- **Tests**: `web/app/screens/installroute-cellular.test.js` (new); the call lists in `installroute-b220.test.js` and
  `installroute-f410b.test.js` gained the extra status read. The three files: 28 pass.
- **Docs**: docs/settings.md (Couldn't Connect on cellular), docs/sideload.md (This iPhone's status row, Quiet Pairing
  Check). Release note: release-notes/B428a.md.
- **Screenshot**: `shots/check.jpg`, left Installation & Signing, right This iPhone not yet tested. Made with
  journal/2026-11-22-f372-builtin-vpn/capture.mjs and `script.json` here, VPN='{"tested":true,"cellular":true,"wifi":false}'.

## Decisions

- A Fix for Pairing Lost still opens Pairing, which shows the alert there.
- A pairing the phone read and turned down (`pairing_rejected`, dropped) isn't a refusal, so it keeps Pair Again.
- Picking This iPhone stays silent.

## Not verified

- Real cellular: the test 15 Pro has no SIM, so the cellular state is the status fake only.
