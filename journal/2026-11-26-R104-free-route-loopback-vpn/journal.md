# R104: a route that works from the phone on a free Apple ID profile

## Question
Can This iPhone install on a free Apple ID profile without a computer for each weekly re-sign? Today the free
profile fails on two counts: iOS refuses the Signing Server's itms-services app (error 111), and This iPhone needs
the built-in VPN, which needs a packet tunnel and so Network Extensions, which a free profile lacks.

## What I did
- Read the code path that refuses a free profile: `LocalVPN.entitled` false gives `LocalVPN.available` false, and
  `IDevice.Session.endpoint` throws `vpn_failed` (`native/sideload/idevice/IDevice.swift` ~717;
  `LocalVPN.swift:45-52`, `:423`).
- Checked on the iPhone 15 Pro (iOS 27.0.1), by hand, not in code. The App Store is signed in. LocalDevVPN (Coxson
  Engineering LLC, free, Developer Tools, 135 ratings) was already installed. Opened it and tapped Connect. iOS asked
  "LocalDevVPN Would Like to Add VPN Configurations" (Allow once). The app then showed Connected, "Connected to
  10.7.1.1/32", and Session details: Tunnel IP 10.7.1.1/32, Device IP 10.7.0.1/32.
- Disconnected LocalDevVPN again afterwards. The Allow stays on the phone.
- The phone has the dev-signed build, not a free-profile build, so no install was tried on the free profile.

## Findings
- The Device IP, 10.7.0.1, is the address iFizBox's `IDevice.address` already uses, so the addressing needs no
  change.
- A third-party loopback VPN is a different app with its own Network Extension. Our App ID therefore needs no
  capability: so a free profile probably can run This iPhone with an external VPN instead of its own (a hypothesis: the connection through it is not verified, see Not verified).
- Without a change, each weekly re-sign needs a computer (see docs/sideload.md, "Free Apple ID: the one-time
  computer setup").

## Proposed change (not built)
- (a) A free profile (no packet-tunnel-provider) is offered This iPhone in "external VPN" mode instead of being
  refused. `endpoint()` skips `LocalVPN.begin` and connects to 10.7.0.1 when a tunnel with IPv4 is up
  (`VPNCheck.tunnels` / `otherVPNUp`, or a `VPNCheck.probe`).
- (b) The Set Up page: step 2 "Allow iFizBox VPN" becomes "Turn on LocalDevVPN", with a link to its App Store page
  and a Test Connection that probes 10.7.0.1.
- (c) An install must hold the VPN the whole run, and the person starts it by hand each time. The app cannot
  switch another app's VPN itself; only a Shortcut can (the Restore My VPN idea), so the first version asks the person. On a failure the alert says "Turn on LocalDevVPN"
  with an Open action.
- (d) Restore My VPN, Cellular Installs and the Quiet Pairing Check's VPN branches are skipped or adapted, since the
  VPN is not ours. The Quiet Pairing Check must not start anything.
- (e) The pairing file still comes from the one-time computer setup, which also installs the app. The computer is
  needed once, never for the weekly re-sign.
- (f) The website's Free Apple ID sign-in already re-signs on the phone. `signing.*` calls stay as they are.

## Tried that failed
- Signing Server route on a free profile: iOS refuses the itms-services app with error 111. No way round found.
- Built-in VPN on a free profile: refused with `vpn_failed`, since the free profile has no Network Extensions.
- Own VPN in a separate free-signed app: impossible, since any packet tunnel needs the capability.

## Alternatives considered
- Asking people to add LocalDevVPN only (what Feather and SideStore do): recommended.
- Own VPN in a separate free-signed app: rejected, see above.
- Signing Server on a free profile: rejected, see above.

## Not verified
- Whether our app's connection to 10.7.0.1 (lockdown and RemotePairing ports) and an installation_proxy install
  actually work through LocalDevVPN's tunnel. The app's guard refuses that route without a code change, so this is
  a research task with no code.
- The free-profile app was not on the phone at the time; the phone has the dev-signed build.
- Whether iOS 27 keeps LocalDevVPN up through a long install with the app in the background.
- Whether LocalDevVPN's tunnel routes only 10.7.0.1.
- The name and App Store link of LocalDevVPN come from the App Store search on the phone.
- StosVPN was not tried.
