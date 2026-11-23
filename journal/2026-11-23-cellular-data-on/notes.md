# R79: This iPhone installs on cellular with data ON, no Shortcut

Question (user, 2026-11-23): iOS refuses lockdown/RemotePairing on cellular, guessed because our utun is tied to
the cellular interface (delegated), so packets count as cellular. Can a different tunnel setup avoid that?
Read first: `journal/2026-11-21-r72-cellular-this-iphone/notes.md` (every tool in the wild turns cellular data
off or uses Airplane Mode for the connect; none works with data on).

## What I did

Read R72's note and `native/sideload/vpn/Extension/PacketTunnelProvider.swift` (current tunnel: device 10.7.0.0/32,
`tunnelRemoteAddress` 10.7.0.1, included route 10.7.0.1/32, `excludedRoutes` = default, mtu 16384, packets
reflected with source/destination swapped).

## Reading, no measurement

- The test variants need a modified extension built, signed and installed on a phone. The brief forbids a code diff
  in a research task, and the 15 has no SIM, so a variant could only be checked there for "still passes on Wi-Fi
  and Airplane Mode" and for what the utun's delegate looks like, never for the cellular result.
- Against the guess: in the current tunnel `tunnelRemoteAddress` is only the utun's point-to-point peer label; the
  routes (not that address) decide what enters the utun, so changing it to 127.0.0.1 or another address is
  unlikely to change which interface the kernel delegates the utun to. An IPv6 pair changes the family of the
  traffic, but the app connects to an IPv4 10.7.0.1 and the services were reached that way in R72's tools.
  Routes with/without the default excluded matters most for the guess: with no excluded default, the utun becomes
  a default route and iOS tags NE traffic by the interface it leaves on; that also sends the user's internet
  through the reflector, so it can only be a test variant.
- None of this is checked. These are the reasons to expect "no change", not findings.

## Filed

T task (variants test build, scratch worktree, not shipped): V1 `tunnelRemoteAddress` 127.0.0.1; V2 another IPv4
pair; V3 IPv6 pair; V4 default route included (no `excludedRoutes` default); V5 the current tunnel as baseline.
Per variant on the 15: utun delegate/type (`getifaddrs` + the delegate ioctl, NWPath, kernel `tcp connect incoming`
lines), `vpn.test` on Wi-Fi and Airplane Mode. If any differs from V5, it blocks `CONFIRM:` with one test
page/button running all variants on cellular for the user's phone (iphone192). No variant ships.

## Not verified

- Everything about cellular: no SIM here, no phone run in this task.
- Any variant's behaviour (none built: research tasks can't carry code; the T task above builds them in a scratch
  worktree).
- The "delegated utun" guess itself: no delegate/interface type read from any phone.
