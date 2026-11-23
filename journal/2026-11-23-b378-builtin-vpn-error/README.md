# B378: the built-in VPN's own error when nothing else is on

## What changed

- `native/sideload/idevice/IDevice.swift`, `Session.endpoint`: when `LocalVPN.begin` throws, the install falls back to
  LocalDevVPN or Tailscale only when one is on (`Session.otherRouteOn`: `Tailscale.useForInstall()` or
  `VPNCheck.status()["localDevVPN"]`). Otherwise it rethrows the VPN's error (`vpn_failed: …`, e.g. "can't start
  without a network"). Before, it connected to 10.7.0.1 with no tunnel and the user saw
  `connect_failed: device socket io failed`.
- The same applies within a minute of a failure (`LocalVPN.failedNow`, which skips a new start): with no other way in
  it throws the kept failure again (`Session.lastVPNFailure`) rather than connecting to 10.7.0.1.
- `web/app/core/installroute.js`: `vpn_failed` is now a route failure (`ROUTE_CODES`). `vpnFailed(raw)` words it:
  title "<built-in VPN> Didn't Start", the shell's reason as the message, Check Again as the fix, and a short line
  that says it needs Wi-Fi or cellular data when the reason is no network. Because `serverFallback` goes through
  `routeFailureOf`, the Signing Server is still offered.
- Test: `web/app/core/installroute-b378.test.js`.

## Tried and dropped

- Capitalising the shell's reason turned the name into "IFizBox". The name now keeps its own case.

## Not verified

- The native change on a phone (the 15 Pro, with Wi-Fi and cellular off, LocalDevVPN and Tailscale off). The gate
  compiles the sideload build but cannot run it. The fallback that still works when LocalDevVPN or Tailscale is on
  was not checked on a device either.
