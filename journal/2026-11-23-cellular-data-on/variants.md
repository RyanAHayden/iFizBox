# T76: tunnel variants against the cellular guess

Answer: no variant differs from the current Built-in VPN tunnel in its delegate or type.
So there is no CONFIRM test page for the user's phone (iphone192), nothing ships, and the Cellular Data Off
path stays. No variant is worth a cellular test.

## Result

On Wi-Fi, iOS gives every variant the same delegate: en0, type 1, functional type 3 (Wi-Fi, infrastructure).
In Airplane Mode every variant's delegate is 0 with functional type 0. The vpn.test check and the TCP connects
to 49152 and 62078 pass in both states for all seven. All 116 "tcp connect incoming" kernel lines during the
runs came in on utun4. Those lines redact the addresses and carry no delegate or cellular field.

| Variant | Wi-Fi delegate/func | Wi-Fi vpn.test | Airplane delegate/func | Airplane vpn.test |
|---------|---------------------|----------------|------------------------|-------------------|
| V5 current, 10.7.0.0 / 10.7.0.1 | en0 / 3 | 151 ms | 0 / 0 | 121 ms |
| V1 remote 127.0.0.1 | en0 / 3 | 138 ms | 0 / 0 | 213 ms |
| V1b remote and saved serverAddress 127.0.0.1 | en0 / 3 | 278 ms | 0 / 0 | 133 ms |
| V2 192.0.2.10 / .11 | en0 / 3 | 155 ms | 0 / 0 | 131 ms |
| V3 fd00:a7::1 / ::2, IPv6 only | en0 / 3 | 157 ms | 0 / 0 | 137 ms |
| V4 included 10.7.0.1/32 only, no excluded default | en0 / 3 | 174 ms | 0 / 0 | 152 ms |
| V4b included default route, no excluded | en0 / 3 | 122 ms | 0 / 0 | 130 ms |

Wi-Fi times are from the second run (16:21 to 16:26), which has the Airplane blocks too. The first run
(16:20) also passed on Wi-Fi, at 114 to 266 ms.

Airplane Mode path: six variants read "unsatisfied (No network route)". V4b reads satisfied through utun4, as
its default route goes into the tunnel. It differs on Wi-Fi too (see Limits), and it would send the user's
internet through the reflector, so it could never ship. V3 has no IPv4 address; V4b's path has no DNS.

## What the delegate says about the guess

The delegation is real. The delegate ioctl (SIOCGIFDELEGATE, 157) reads en0 for utun4 on Wi-Fi and 0 in
Airplane Mode. nesessionmanager logs "manager set delegate interface name to en0" on every start, "(null)"
when the network goes, and "Starting on physicalInterface en0". So it picks the delegate from the physical
interface in use. The settings we changed (remote address, server address, routes, addresses, IP family) did
not change that choice here. nesessionmanager logged the tunnelRemoteAddress and ServerAddress of each variant, so
the variants did reach the tunnel.

INFERENCE, not measured: on cellular the physical interface would be pdp_ip0. The utun would then be delegated
to cellular and count as cellular traffic, which fits iOS refusing lockdown and RemotePairing there. No
variant on the list changes which interface that is, because the delegate follows the physical interface.

## Variants

V5 is the current tunnel, the baseline. V1 sets tunnelRemoteAddress to 127.0.0.1. V1b adds the saved
configuration's serverAddress set to 127.0.0.1, since nesessionmanager might pick the interface from it too.
V2 is another IPv4 pair (192.0.2.10, .11). V3 is IPv6 only (fd00:a7::1, ::2). V4 includes only the peer
route and drops the excluded default. V4b includes the default route and drops the excluded default.

## How it was run

- iPhone 15 Pro, iOS 27, no SIM. The phone was used because Chromium has no NetworkExtension.
- A test build from a scratch worktree of e74a8612, the variant chosen by a start option. Opened by the
  ifizbox://vpn-variants link (a page with Run All and Copy). Results also went to Documents/vpn-variants.txt,
  pulled with afcclient. tools/ui-15.sh signed and installed it.
- The test build turned the Install Switch and Cellular Shortcuts off for its runs.
- Airplane Mode: the VPN came up on Wi-Fi first, then Airplane Mode was switched on through WebDriverAgent by
  the switch's label, then the test ran on the tunnel already up. iOS starts no VPN without a network (B375).

Proof of which variant ran: utun4's addresses in the results (10.7.0.0 / 10.7.0.1, 192.0.2.10, fd00:a7::1)
and nesessionmanager's log of each start's settings: tunnelRemoteAddress, ServerAddress, and the routes (V4 and V4b
have no excludedRoutes there, the others do).

## What went wrong

- In the first attempt V1, V2 and V4b turned off as they started. The app's own 3 s linger timer from the
  previous verify stopped the next tunnel ("Received a stop command from iFizBox"). A harness fault; the test
  build now has linger off.
- The extension's handleAppMessage answer came back nil, and NSLog from the extension never showed in the
  syslog stream. nesessionmanager's log was used instead.
- A redirected second afcclient get needs a new file name.
- nesessionmanager logs "failed to set the MTU to 16384" on every start. Seen, not looked into.

## Afterwards

The unmodified build of e74a8612 (0.25.0) was installed. The saved configuration's serverAddress went back to
10.7.0.1, Airplane Mode went off, the test file was removed, the device lock was released, and the scratch
worktree was deleted. None of the test code was merged or shipped.


## Limits of these readings

- Choosing not to ask for a cellular run was a judgement. V4b does differ in the phone's own path (below), on Wi-Fi
  (default path utun4, no DNS) and in Airplane Mode (satisfied through utun4). Its utun has the same delegate and
  functional type as V5's in both states, and those are what would mark the tunnel as cellular. V4b is an extra to the
  task's list (R79's reading of V4), and while it is up the phone has no internet. V3's path to the peer has no IPv4,
  as expected of an IPv6-only tunnel. V1, V1b, V2 and V4 differ from V5 in nothing read here.
- The 15 only ever had one physical interface in use (no SIM), so "the settings don't reach the choice" is shown for
  Wi-Fi and for no network, not for Wi-Fi against cellular.
- "vpn.test" here is its connect (IDevice.verify) on the variant's tunnel, already up, without its Shortcuts.
- variants-results.txt is cut down: the `tunnel: nil` lines and the interfaces other than utun4 are left out. It ends
  with the syslog per run. The syslog dropped lines at 16:20 (V4, V4b: 1 and 0 kernel lines although both connected);
  the 16:25 runs have all 5 on utun4. In the Airplane runs (second block of each) the settings aren't logged again.
- The test build's source was thrown away with the scratch worktree. A rerun would need it written again.

## Not verified

- Anything on cellular (no SIM here). That includes that the delegate is pdp_ip0 there and that this is why
  iOS refuses.
- V1 to V4 on the user's phone.
- A delegate change when Wi-Fi drops to cellular with the tunnel up.
- Other knobs outside the list: includeAllNetworks, enforceRoutes, and a tunnel started with no network.
- The MTU error.
- Whether the connects to 49152 and 62078 are accepted at all depends on the delegate.
