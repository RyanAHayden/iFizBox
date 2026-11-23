# F372: built-in VPN for This iPhone installs

Built from the approved concept (branch concept/local-vpn, 910f7aee); its SAMPLE answers, default route and
markTested are replaced by real bridge calls.

## What was done

- **Native** (`native/sideload/vpn/`): `Extension/PacketTunnelProvider.swift`, a packet tunnel written for iFizBox on
  the StosVPN/LocalDevVPN idea (phone 10.7.0.0/32, route 10.7.0.1/32 only, default route excluded, every IPv4
  packet written back with source and destination swapped; checksums unchanged). `build.sh` builds it into
  `PlugIns/iFizBoxVPN.appex` for the IPA only (`native/build.sh`). `App/LocalVPN.swift`: the manager
  (NETunnelProviderManager, saved enabled, never On Demand), `begin`/`end` with a 3 s linger, `available` only when
  the app's embedded profile has `networkextension` `packet-tunnel-provider`, the network path (NWPathMonitor), the
  Cellular Shortcuts through `shortcuts://x-callback-url/run-shortcut` coming back as `ifizbox://vpn-shortcut`
  (App.swift's Incoming), and the `vpn.*` calls. `IDevice.Session.endpoint` turns it on before connecting (falls back
  to LocalDevVPN/Tailscale if it won't start, and skips it for a minute after a failure); Cellular Data On runs once
  connected. `idevice.status` carries `vpn`. Entitlements: the app and the extension get Network Extensions
  (packet tunnel); the user's signer swaps in its profile's, and iFizBox's own App IDs already get the capability
  (F279's APP_ID_CAPS).
- **Web**: core/installroute.js (BUILTIN_VPN, builtinVPN, iphoneSetUp, setupFooter, cellularWarning, CELLULAR,
  HOW_STEPS, test-result words; decideRoute/installStatus/verifyFailure/routeRefused for the built-in VPN, the
  cellular alert). screens/installroute.js: Installation & Signing lists both ways with USE/ACTIVE (clip-path reveal),
  USE on This iPhone not set up opens its page and the passing test uses it; This iPhone = Set Up + How It Works;
  Cellular Shortcuts page; How It Works page; Signing Server page. Without `vpn.available` the old Tailscale /
  LocalDevVPN groups stay (C64 removes them later).
- **User note 2026-11-22** (dropped from the plan line when F372 was reopened; taken from commit 246a38c7): on
  cellular with the Shortcuts missing, Home's status slot (home.js cellularTile, opens Cellular Shortcuts), the
  status cell (Add the Cellular Shortcuts) and an install that starts (Use Server / Try Anyway / Set Up) say so.
- Tests: `screens/installroute-f372.test.js` (node), `native/sideload/vpn/test_vpn.py`, mkipa.py check now requires
  the VPN extension (test_ipa.py fixtures updated), older tests updated to the concept's one-line subtitles and rows.

## Checks

- `native/build.sh ipa` builds; mkipa check passes; the appex carries the packet tunnel point and entitlement.
- Chromium (capture.mjs + script.json here, fake sideload shell with `vpn.*`): main page USE/ACTIVE, USE on This
  iPhone not set up opened its page and left the route on the Signing Server, Test Connection -> Connected alert
  and the route became This iPhone, Cellular Shortcuts Add/Added/Test Shortcuts, How It Works, the ACTIVE reveal
  caught mid-way, USE on the Signing Server set it. Shots were looked at, not committed.

## Tried and failed

- The iPhone 15 Pro: `tools/ui-15.sh F372 install` failed, `/var/run/usbmuxd` missing; `lsusb` shows no Apple
  device: the phone isn't on the desktop's USB (it is online on the tailnet as iphone-15-pro-1, but go-ios needs
  USB). Lock taken and given back.
- First build: `NWPath` ambiguous (NetworkExtension's deprecated NWPath vs Network's): qualified as Network.NWPath.

## Not verified

- **Anything on a phone**: the tunnel starting, iOS's "Add VPN Configurations" prompt, pair/test/install through it,
  Tailscale coming back after (VPN On Demand), whether enabling our configuration deselects Tailscale's so it does
  not come back by itself. Why: the 15 Pro isn't plugged in (above). The task blocks on that.
- **Cellular Shortcuts**: running them through x-callback-url, the path leaving cellular, the connection surviving
  data coming back. Needs a phone with a SIM (the user's); filed as a follow-up.
- Adding a Shortcut: Shortcuts can't be pre-filled without a signed .shortcut file, so Add opens a blank Shortcut and
  the footer says what to put in it; Added is the user's word until Test Shortcuts runs them.
