# R72: This iPhone installs on cellular

Follow-up to R70 (`journal/2026-11-21-r70-tailscale-wifi-only/`): on cellular the user's iPhone (iphone192)
refused RemotePairing (49152) and lockdownd (62078) through Tailscale; on Wi-Fi it took both. The user wants
This iPhone installs to work on cellular too.

## (1) What the open-source tools do (read from their code and docs)

Sources cloned shallow on 2026-11-21 (commit, date):
- SideStore/SideStore `4f3d18d` (2026-11-06), SideStore/SideStore-Docs `7e441d3` (2026-10-14)
- StikDebug/StikDebug `63713ea` (2026-11-20), StikDebug/StikDebug-Guide `6f9625c` (2026-11-01)
- SideStore/StosVPN `010bc14` (2026-03-31); LocalDevVPN: SiamSadik/LocalDevVPN `1b9ff7a` (2026-08-16), the
  open-source tree of the App Store LocalDevVPN (its `PacketTunnelProvider.swift` header: "Created by Stossy11",
  the StosVPN author; same tunnel as StosVPN with /32 routes).

**None of them makes lockdown/RemotePairing work while cellular data is up.** All of them take cellular out of the
way for the moment the connection opens: Airplane Mode, or turning Cellular Data off. None asks for Wi-Fi to be on
or joined.

- **StikDebug** (`StikDebug/Services/ConnectionDiagnostics.swift`): when a connection to the loopback target
  (`10.7.0.1`) fails, it reads the path with `NWPathMonitor`; `cellular && !wifi` (Wi-Fi in use, i.e. joined,
  not merely switched on) is diagnosed as `.cellular`, titled **"Enable Airplane Mode"**, message: "Keep
  LocalDevVPN connected. Enable Airplane Mode by swiping down from the top-right corner of your screen and
  tapping the airplane icon, then return here." After a connection made with neither Wi-Fi nor cellular in use
  (`connectedNotice`): "Connected over Airplane Mode. You can now disable Airplane Mode if you wish, StikDebug
  will remain connected." So: loopback VPN + no Wi-Fi + no cellular = connects; the connection, once up, survives
  cellular coming back. "Wi-Fi switched on but not joined" counts as no Wi-Fi there (`usesInterfaceType(.wifi)` is
  false), so StikDebug would still tell that user to turn on Airplane Mode.
- **SideStore docs** (`docs/advanced/jit.mdx`): "Start by opening LocalDevVPN on Wi-Fi or Airplane Mode. Now, if
  using cellular data, start the VPN, enable Airplane Mode, then switch back to cellular." German page: "turn both
  Wi-Fi and Mobile Data OFF when you launch StikJIT (use Airplane Mode)".
- **SideStore "Cellular Refresh"** (`SideStore/Core/Shortcuts/CellularRefreshManager.swift`, setting under
  Advanced > User Customizations: "Automatically toggle cellular data via Shortcuts during refresh"): before each
  step that talks to lockdown (install, refresh, profile injection, JIT, uninstall, device registration;
  `turnOffDataIfNeeded` call sites), when Wi-Fi isn't in use (`!minimuxer.network.isWifiSatisfied`) it opens
  `shortcuts://run-shortcut?name=TurnOffData` (a Shortcut the user makes with "Set Cellular Data: Off"), waits
  1 s plus up to 2 s for minimuxer to be ready, does the step, then runs `TurnOnData`. It does Apple's account
  work with data on and only the lockdown part with data off. It refuses with WireGuard: "WireGuard VPN is not
  supported with Cellular Refresh because iOS pauses the WireGuard tunnel when cellular data is toggled off."
- SideStore PR #935 (merged 2025-04-09, "stosVPN can work on cellular too") only removed a ready check that
  showed NO WIFI/VPN; Cellular Refresh came a year later (file dated 2026-04-09), which says plain cellular
  wasn't enough after all.
- **StosVPN / LocalDevVPN** (`TunnelProv/PacketTunnelProvider.swift`): a packet tunnel with the device at
  `10.7.0.0/32` and a route for `10.7.0.1/32` only, default route excluded; every packet read is written straight
  back with `10.7.0.0 <-> 10.7.0.1` swapped, so an app's connect to 10.7.0.1 arrives at the phone's own services
  as from a peer on the utun. Nothing in it touches Wi-Fi or cellular; it doesn't bring any listener up.

### What that means for R70's reading

R70 concluded "iOS takes 49152/62078 from the network only while the phone is on Wi-Fi". The tools show a
narrower rule: **iOS refuses these connections while cellular data is in use**, and takes them with no Wi-Fi at
all (Airplane Mode with Wi-Fi off, StikDebug's notice). Wi-Fi being joined only matters because a joined Wi-Fi
takes the default route away from cellular. Both readings fit R70's two measurements.

### Consequence per route

- **LocalDevVPN (10.7.0.1)**: works on a cellular phone if cellular data is off while iFizBox connects: Airplane
  Mode (with Wi-Fi off or on) or Settings > Cellular > Cellular Data off. LocalDevVPN needs no internet, and
  signing happens on the phone, so the whole install can run with data off; the IPA must be downloaded first
  (or with data on, then data off for the install). An open connection survives data coming back (StikDebug), so
  turning data on again mid-copy is expected to be fine, untested for iFizBox.
- **Tailscale**: can't. Tailscale (like WireGuard) needs the internet to reach the phone's own node from
  iFizBox's node; with cellular data off there is none, and with it on iOS refuses. SideStore refuses the same
  combination for WireGuard. On cellular the Tailscale route has to hand over to LocalDevVPN (or the Signing
  Server).

## (2) On the iPhone 15 Pro (22:43-22:45 local, UI lock R72)

What the 15 can't do: it has **no LocalDevVPN** (App Store app, needs the owner's Apple ID; R66 found the same), and
no SIM, so with Wi-Fi not joined it has no internet at all: the Tailscale address can't be reached from the
desktop and iFizBox's own Tailscale node (signed out anyway, R64/R66) couldn't either. So "do 49152/62078 answer on
the loopback/VPN address with Wi-Fi on but not joined" can't be measured on it. What I did instead
(`probe.py`, `syslog-15-wifi-toggle.txt`; screenshots in `ref/15/screens/r72-cc1..3.png`, not committed):

| Time | State (Control Center) | Tailscale 100.109.186.91 49152 / 62078 / 49153 | LAN 192.168.0.194 |
|---|---|---|---|
| 22:19:59 | Wi-Fi joined, Tailscale VPN on | open / open / refused | open / open / refused |
| 22:43:48 | Wi-Fi tile tapped: on, not joined; the VPN badge gone | timeout (no path) | no route (EHOSTUNREACH) |
| 22:45:03 | Wi-Fi tile tapped again: joined, VPN back | open / open / refused | open / open / refused |

lockdownd's own log over USB (`pymobiledevice3 syslog live`): `WiFi link down.` + `wifi_link_down_callback` the
moment the tile was tapped (22:43:39), and `WiFi link up.` + `update_bonjour_service_instance_name` when it rejoined
(22:44:48). So lockdownd does track the Wi-Fi link, and "Wi-Fi on, not joined" is a link-down for it, the same as
Wi-Fi off. What it does on link down beyond the Bonjour name isn't logged (lines are `<private>`); no "stop
listening" line appeared. The kernel logs every inbound connect with its interface (`tcp connect incoming: [...:62078
...] interface: en0` / `utun5`), which would show on the user's phone which interface a refused connect came in on.

Reading: this doesn't decide between "the listener needs a Wi-Fi link" (R70) and "connections are refused while
cellular is in use" (the tools). The tools' behaviour (Airplane Mode with Wi-Fi off connects) only fits the second,
and the link-down callback drives at least the Bonjour advert (Wi-Fi sync), which explains why it exists without
the listener depending on it. Either way, **Wi-Fi switched on but not joined is not expected to help**: lockdownd
sees it as link down, and StikDebug counts it as no Wi-Fi.

## (3) Steps for the user's phone

`steps.md`: on cellular, Check Connection with Wi-Fi on not joined through Tailscale and through LocalDevVPN, then
with Cellular Data off, then an install with data turned back on mid-copy, then Airplane Mode. The task blocks with
it (`CONFIRM:`). Expected from the code: refused, refused, connected, finishes, connected.

## Outcome

- Works on cellular (from SideStore's and StikDebug's code, to be confirmed by the steps): **LocalDevVPN with
  Cellular Data off** (or Airplane Mode) while iFizBox connects; data can come back once the connection is open.
  The one switch to tell the user: Cellular Data (Control Center). Wi-Fi switched on alone: not expected to work.
- Tailscale can't work on cellular: data off leaves no internet for it, data on gets refused.
- Follow-up filed: **F368** (`--after R72`): on cellular, This iPhone downloads and signs with data on, asks for
  Cellular Data off, waits for the path to change, connects over LocalDevVPN, then says data can go back on;
  Tailscale on cellular hands over to LocalDevVPN or the Signing Server. Its first step is to read R72's note for
  the user's answers.

## Not verified

- **Anything on a phone on cellular**: the 15 has no SIM, and the user's phone (iphone192) was on home Wi-Fi at
  22:19 (`tailscale ping` via 192.168.0.60). Every cellular claim above comes from SideStore's and StikDebug's code
  and docs, and from R70/B316's one cellular measurement. That is what `steps.md` asks the user for.
- **The loopback route (10.7.0.1) on the 15 with Wi-Fi not joined or off**: no LocalDevVPN on the 15 (needs the
  owner's Apple ID to install). Not tried: installing it through the App Store with the 15's signed-in account
  (R66 judged it the owner's call; I kept to that).
- **lockdownd over the go-ios USB tunnel with Wi-Fi off** (its userspace port 60121 reaches the phone's CoreDevice
  utun): not tried; that interface belongs to RemotePairing itself and is likely trusted on its own terms, so it
  wouldn't tell about LocalDevVPN's or Tailscale's utun.
- **Airplane Mode on the 15**: not toggled; with no SIM it is the same as Wi-Fi off for reachability, and nothing
  could reach the phone in that state to test.
- **Whether an open iFizBox install connection survives Cellular Data coming back**: StikDebug says its tunnel
  does; iFizBox's installd session over LocalDevVPN wasn't tried (step 5 asks the user).
- **What lockdownd does on Wi-Fi link down beyond the Bonjour name**: its log lines are `<private>`.
- **SideStore's Shortcut-driven Cellular Data toggle** wasn't run; it was read only.

## Log

- Cloned the six repos above into the scratchpad and grepped for cellular/airplane/Wi-Fi.
- 22:16-22:18 local: the 15's UI lock was held by P301b; `ios apps` (read-only) showed no LocalDevVPN on the 15
  (Tailscale 1.104.7, iFizBox 0.19.1, the probe app), as R66 found. `tailscale ping`: both phones on home Wi-Fi
  (iphone192 via 192.168.0.60, the 15 via 192.168.0.194), so no cellular sample was possible from the desktop.
- Filed F368 (the build, `--after R72`) before the 15 run, from the code findings.
- Waited for the lock (P301b had it) with a background loop; got it 22:43, released it 22:45.
- A pid file for the syslog capture landed in the worktree (the `cd` before it didn't carry); removed it and
  stopped the capture by that pid.
- My 22:45:03 probe shows in the log as en0 (LAN) then utun5 (Tailscale). A connect to 49152/62078 over utun5
  at 22:44:50 wasn't mine; another session's probe, probably.

## Spec review

Fixed: step 5 started an install with data off, which needs the IPA downloaded first (now: an IPA already in My IPAs); F368 noted that the cellular rule is from SideStore/StikDebug code and stays conditional until the user answers. Kept: steps 4-6 beyond the brief (Cellular Data off, Airplane Mode) are the setups the tools use; F368 at normal (it waits on R72); the test file name follows the repo's installroute-b316 style. (2) stays partial, written under Not verified.
