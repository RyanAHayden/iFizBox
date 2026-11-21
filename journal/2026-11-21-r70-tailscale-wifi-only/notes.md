# R70: why the user's phone refuses every port over Tailscale

Follow-up to B316 (`journal/2026-11-21-b316-tailscale-refused/notes.md`, point 2: "most likely iOS only accepts
these services over the network while Wi-Fi is up; not proven").

## Measurements (from the desktop, a tailnet peer; no phone lock, nothing run on a phone)

Probe: `socket.connect` with a 5 s timeout to 49152 (RemotePairing), 62078 (lockdownd) and 49153 (a control port
nothing listens on), times are the connect's own. Endpoint from `tailscale ping` ("via <addr>"); `tailscale status
--json` gives no `Addrs`/`CurAddr` for these iOS peers, so the ping line is the only endpoint view.

| When (UTC) | iphone192 endpoint | 100.123.95.114:49152 | :62078 | :49153 |
|---|---|---|---|---|
| 2026-11-21 ~22:40 (B316) | 174.252.157.109 (Verizon Wireless, cellular) | refused, 40-130 ms | refused | (not probed) |
| 2026-11-21 23:26 (R70) | 192.168.0.60:41641 (home Wi-Fi, direct) | **open**, 38 ms | **open**, 3 ms | refused, 4 ms |

Controls at 23:26:
- The phone's LAN address without Tailscale, `192.168.0.60`: 49152 open, 62078 open, 49153 refused.
- The iPhone 15 Pro (`100.109.186.91`, home Wi-Fi via 192.168.0.194): 49152 open, 62078 open, 49153 refused, the
  same as B316 measured.

Repeated every 30 s from 23:26:25 to 23:35:57 (20 rounds): every round 49152 open (7-13 ms), 62078 open (3-17
ms), 49153 refused. The endpoint was `192.168.0.60:41641` throughout except 23:34:27 and 23:34:57,
`96.60.54.66:3342`, which is the home's own public address (`tailscale netcheck` on the desktop: IPv4
96.60.54.66), so still home Wi-Fi by another path; ports answered the same then.

## Conclusion

Same phone, same Tailscale node (`iphone192`, key valid to 2027-05-14), same desktop and tailnet rules: on
cellular every port was refused at the round trip (the phone's own reset coming back through the tunnel); on Wi-Fi
RemotePairing and lockdownd answer through Tailscale exactly as on the LAN. So iOS takes RemotePairing (49152)
and lockdownd (62078) over the network only while the phone is on Wi-Fi: their network listeners belong to Wi-Fi
(as Wi-Fi sync does), and a VPN interface over cellular doesn't bring them up. Installs through This iPhone over
Tailscale need the phone on Wi-Fi (any Wi-Fi with internet: the tailnet carries the rest); off Wi-Fi the Signing
Server is the way.

This meets the brief's test ("If Wi-Fi answers and cellular refuses"), so the hedge goes:
- `web/app/core/installroute.js` `routeRefused` (Tailscale): "…on cellular, try on Wi-Fi." becomes a plain rule
  (iOS only accepts these connections on Wi-Fi: join Wi-Fi, or use the Signing Server), and its comment.
- `docs/sideload.md`, This iPhone over Tailscale: the phone must be on Wi-Fi; on cellular iOS refuses every port.

R70 is research, so it changes neither: filed as **B318** (installroute.js, installroute-b316.test.js,
sideload.md). The user's own error in B316 (refused on
every port after signing Tailscale back in) is explained by this.

## Not verified

- **A cellular measurement in this session**: the phone stayed on Wi-Fi (home network for all 10 minutes of the log); the cellular side is
  B316's 22:40 measurement. Nothing was asked of the user (no phone lock, rule: test on the 15, not the user), and
  the 15 has no SIM, so no second phone could show the cellular side.
- **Other differences between the two times**: lock state and which app was in front aren't visible from the
  desktop. B316 showed the 15 stays reachable locked (without a passcode); a passcode-locked phone isn't covered.
  The refusals were immediate resets, not timeouts, which fits a closed listener rather than a dropped packet.
- **Cellular with Wi-Fi on but not joined**, and a Personal Hotspot client: not tried (needs the user's phone).
- **Why iOS ties it to Wi-Fi** (which daemon decides): inferred from the behaviour, not read from iOS.

## Log

- Started 23:26 UTC: `tailscale ping` showed iphone192 direct on 192.168.0.60 (home Wi-Fi), probed at once.
- A 10-minute background log (ping + probe every 30 s) to catch an endpoint change: none to cellular.
- `tailscale status --json` was tried for the endpoint first: no `Addrs`/`CurAddr` for iOS peers; used the ping.
- Filed B318 for the wording (plan add needed `--force`: it matched R70 itself as "the same work").
- A stray wait command (`timeout 590 tail -f --pid=1 /dev/null`) was started by mistake; it ends on its own
  timeout and does nothing.
