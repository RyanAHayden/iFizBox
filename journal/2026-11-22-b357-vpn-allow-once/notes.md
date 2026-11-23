# B357: the built-in VPN asks Allow once (setup's test), never at each install

## What changed

- `native/sideload/vpn/App/LocalVPN.swift`: `down()` only stops the tunnel. The `removeFromPreferences` branch and
  `otherWasOn` (F372's "give Tailscale its checkmark back") are gone, so the configuration stays saved and the next
  install's `manager()` finds it enabled (no new save, no "Add VPN Configurations"). `begin()` no longer looks at
  other tunnels (`VPNCheck.tunnels()` was only there to set `otherWasOn`). The user's call: they don't use the
  Tailscale route, so ours stays; a VPN that relies on On Demand (Tailscale) stays off after an install until the
  user turns it on (written in docs/sideload.md).
- `web/app/screens/installroute.js`: pairing's last step. When the pairing (idevice.pair, or Import Pairing File)
  ends and the idevice.status from before it has the built-in VPN untested (`needsTestAfterPairing`), the page draws
  "Testing the Connection…" with its spinner (`setupGroups("testing")`, `TESTING_AFTER_PAIRING`) and runs `vpnTest`,
  the same call and alerts as Test Connection; it says Paired only after. That first `vpn.test` is when iOS asks to
  add the configuration. `v.testing` is set before `store.set(ROUTE_KEY)` because the store's set redraws the page.
  A failed test shows its alert and the page then shows Paired, with Set Up's footer still saying to test.
- Tests: `web/app/screens/installroute-b357.test.js` (built-in VPN: test runs by itself after pairing, spinner, Paired
  after; failure; without the built-in VPN or already tested: no vpn.test; the Swift source has no removal).
- Docs: docs/sideload.md (configuration never removed, Allow once at setup), docs/settings.md (Pairing runs the test).
  Release note `release-notes/B357.md`.

## Decisions

- The brief's "core/installroute.js" file needed no change: `setupFooter`/`iphoneSetUp` already say "test to finish"
  until `vpn.tested`, which the automatic test sets.
- Set Up's "Pair This iPhone" row still says Done once paired (it is): the test runs on the pairing page before that
  page says Paired, which is where the user saw Done-without-test.

## Tried and failed

(filled in below as the phone check goes)

## Not verified

(filled in below)
