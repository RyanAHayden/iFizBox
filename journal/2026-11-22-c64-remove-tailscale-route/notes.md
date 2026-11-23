# C64: remove the Tailscale route and LocalDevVPN

The user OK'd it on 2026-11-23 (built-in VPN checked on their phone), so the removal is done.

## What I did

- Native: `native/sideload/tailscale/` (tsnet c-archive, Go build, Swift) deleted; build.sh, check.sh, plist
  (`LSApplicationQueriesSchemes` is `apple-magnifier` only), notices and tests follow. `IDevice.Session` has one route,
  the built-in VPN; a build without Network Extensions fails with `vpn_failed`. `VPNCheck` keeps only what the VPN
  needs. Bridge: `tailscale.*`, `idevice.openLocalDevVPN`, `idevice.vpnApps` and the `tailscale`/`localDevVPN`
  status keys are gone. The kept Install Apps With choice moved to `route.keep` / `route.kept`
  (`native/sideload/idevice/KeptRoute.swift`); it keeps the old Keychain service string so a kept route survives the
  update.
- Web: `core/installroute.js` and `screens/installroute.js` lose Connect With, the Tailscale group and sign-in, the
  VPN row, the LocalDevVPN alerts and wait (`waitForVPN`, the "vpn" run phase). `This iPhone` always draws Set Up and
  How It Works from the first frame (rows Checking…, Not Responding when late or failed). A profile without Network
  Extensions says so (core `NO_VPN`): Set Up row, status cell, alert, check.
- Credits no longer name Tailscale; Why page text, docs and glossary updated.
- Settings RETIRED: nothing to add, the Tailscale settings lived in the shell's UserDefaults, not in web settings.
- Tests: Tailscale/LocalDevVPN-only tests deleted, the rest rewritten; `installroute-c64.test.js` checks that no
  state draws Tailscale or LocalDevVPN and drives the page with a delayed, late and failed `idevice.status`.
- `shot.mjs` (Chromium, `idevice.status` delayed 4 s, no cached status): first frame already shows Set Up with
  Checking… rows and How It Works, for the built-in VPN, no-Network-Extensions and failed-status cases; none names
  Tailscale or LocalDevVPN.

## Not verified

- The 15 Pro installing through the built-in VPN after this build (needs the phone; the VPN path itself is unchanged).
- The Why page's "routes" screenshot (web/app/img/why) was not redrawn.
- Set Up gains a footer when the first answer lands, so that group slides at that moment.
