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

## Spec review

- Fixed: the test after pairing depended on the remembered idevice.status; with none it would be skipped silently.
  It now reads the status when none is remembered (test added).
- Kept: Set Up's Pair This iPhone row says Done once paired (it is paired); the pairing page, where setup ends, is
  what now waits for the test. `finishSetup` is returned, not awaited, inside pairing's try: `vpnTest` handles its own
  errors, and a test failure must not read as Couldn't Pair.
- Known, by design: a phone already tested under F372's build gets no automatic test, so its first install after
  updating asks Allow once (seen on the 15), then never again; Tailscale isn't given its checkmark back (docs say so).

## iPhone 15 Pro (2026-11-23 00:03-00:06, lock B357)

Built with `native/build.sh ipa` (native/build/iFizBox.ipa), installed with `tools/ui-15.sh B357 install`, driven
through `pymobiledevice3 webinspector cdp` (port 9347; 9333 and 9334 were held by other sessions' servers) with
`ifizboxNative.call(...)` evals, shots with ui-15.sh. The phone needs the real device because the change is in
the native shell (NETunnelProviderManager, iOS's Allow) and Chromium has no VPN.

- Before: paired (rp), Tailscale on (utun4), vpn tested=true from F372's build, which had removed our configuration.
- `vpn.test` #1: iOS showed "iFizBox Would Like to Add VPN Configurations" (no configuration was left by the old
  build: expected once); Allow tapped; `{ok, ms: 185}`.
- `vpn.test` #2 with the VPN off between (`vpn.status.on` false): `{ok, ms: 153}`, no prompt, no tap.
- Two installs in a row (`signing.resign` of the Probe test app, `route: "idevice"`): both "Connected to iOS through
  iFizBox VPN (RemotePairing tunnel)", "iOS installed Probe 1.0", no prompt in the shots taken during each.
- Settings > VPN after: "iFizBox VPN" still listed (with the checkmark), Not Connected; Tailscale listed without it.
  I gave Tailscale its checkmark back and switched it on so other tasks find the phone as they expect.

## Tried and failed

- First install: `appid_mismatch` (the Probe on the phone was rig-installed under another App ID, as F372 also
  hit); the VPN part had worked. Uninstalled Probe with `ios uninstall com.ryha.ifizbox.probe`, then both installs
  went through.

## Not verified

- **Pairing from scratch on the phone (the automatic test after pairing)**: the 15 is paired; forgetting the pairing
  to redo it needs the pairing code typed in iOS Settings again and would leave the shared test phone unpaired for
  other tasks. Covered by `installroute-b357.test.js` with the fake bridge; the native `vpn.test` it calls is the
  one checked on the phone above.
- **Tailscale's return after an install**: by design it no longer gets the checkmark back; a user of the Tailscale
  route must re-select it in Settings > VPN. Not a check, a known consequence the user chose.
