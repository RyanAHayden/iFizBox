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

## iPhone 15 Pro (after the user plugged it in, 21:52-22:17, lock F372)

Installed with `tools/ui-15.sh F372 install` (the rig's RSideload profile has networkextension incl.
packet-tunnel-provider), driven with taps and the web view over `pymobiledevice3 webinspector cdp` (`ev.mjs` here).
Screens in `ref/15/screens/f372-*.png` (not committed).

- `idevice.status.vpn`: `available: true, entitled: true, bundled: true`; already paired (rp); Tailscale VPN on.
- Installation & Signing (iOS 26 style): both ways with ACTIVE / USE; This iPhone page Set Up + How It Works.
- Test Connection: iOS showed "iFizBox Would Like to Add VPN Configurations"; after Allow, "Connected" (the first
  try's ms counted the Allow wait; now the ms is the connect alone: 147-158 ms later).
- Install of Probe from My IPAs: "Connected to iOS through iFizBox VPN (RemotePairing tunnel)", "iOS installed
  Probe 1.0". (A first try hit `appid_mismatch` for the copy already installed under another App ID; uninstalled it
  with go-ios, then it installed.)
- **Tailscale after**: with the configuration kept (first build), Settings > VPN's checkmark stayed on iFizBox VPN
  and Tailscale never came back (polled 1 min+). Setting ours `isEnabled = false` after: the checkmark stayed on
  ours, Tailscale didn't come back. Removing ours (`removeFromPreferences`) after: the checkmark went back to
  Tailscale and its On Demand reconnected it (seen in Settings and in idevice.status: utun4, 100.109.186.91, within
  1-4 minutes). The cost: the next save is a new configuration, so iOS asks Allow again (seen). Shipped: removed
  only when another VPN was up when ours turned on; without one it stays and iOS asks once.
- Fixed from what the phone showed: the install log said "through LocalDevVPN (10.7.0.1)" (Sideload.swift), now
  iFizBox VPN; the Test row stayed "Test" under the Connected alert (now marked tested before it repaints).

Seen, left for later (filed): the main page's This iPhone subtitle truncates in the iOS 26 style ("Works offline -
no install pop..."); My IPAs' sign page footer still says "(LocalDevVPN or Tailscale)".

## Tried and failed

- The iPhone 15 Pro: `tools/ui-15.sh F372 install` failed, `/var/run/usbmuxd` missing; `lsusb` shows no Apple
  device: the phone isn't on the desktop's USB (it is online on the tailnet as iphone-15-pro-1, but go-ios needs
  USB). Lock taken and given back.
- First build: `NWPath` ambiguous (NetworkExtension's deprecated NWPath vs Network's): qualified as Network.NWPath.

## Spec review

- Fixed: USE before setup kept a module flag forever, so a later Test Connection switched the way in after the user
  had backed out; it now holds 10 minutes (USE_HOLD), with a node test.
- Kept, on purpose: the fallback to LocalDevVPN/Tailscale when the built-in VPN won't start, and the old groups
  without `vpn.available` (a profile without Network Extensions still installs; C64 removes them after the user's
  OK); home.js and signing/route.js are the user's 2026-11-22 note; mkipa/test_ipa check the new extension.
- Answered: the App ID capability is already asked for (core/asc.js and ASC.swift APP_ID_CAPS have
  NETWORK_EXTENSIONS); the Signing Server page gets settings.js's `server` sections; Add marks a Shortcut added
  when tapped, as the concept does, and Test Shortcuts is what proves it (under Not verified).
- Filed R73 (after F372): the cellular check on the user's phone, which blocks CONFIRM with the steps.

## Not verified

- **Pairing from scratch with the built-in VPN**: the 15 was already paired; forgetting the pairing to redo it would
  have needed the Developer Mode code typed in Settings again. The pairing code path itself didn't change (vpnOn is
  true with the built-in VPN, so the page goes straight to pairing).
- **Tailscale's return without traffic**: it came back between 1 and 4 minutes after the install; it reconnected by
  the time Settings was opened, so what triggers its On Demand (time, or another app's traffic) wasn't pinned down.
- **The final build's keep-when-no-other-VPN branch**: every phone run had Tailscale on, so the path that keeps the
  configuration (no other VPN up) ran only in the first build, where it worked (no second Allow).
- **Cellular Shortcuts**: running them through x-callback-url, the path leaving cellular, the connection surviving
  data coming back. Needs a phone with a SIM (the user's); filed as a follow-up.
- Adding a Shortcut: Shortcuts can't be pre-filled without a signed .shortcut file, so Add opens a blank Shortcut and
  the footer says what to put in it; Added is the user's word until Test Shortcuts runs them.
