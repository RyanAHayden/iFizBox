# F411: Restore My VPN, native part

## Did

- `native/sideload/vpn/App/LocalVPN.swift`: kept setting (`restore`, off by default), bridge `vpn.setRestore {on}`,
  `restore` in `idevice.status`'s `vpn`. `noteOther` (in `start()`, before the save that takes the other VPN's place)
  records that a VPN was up; `giveBack` (at the end of `downIfIdle`, under `startLock`, so no start overlaps a removal)
  removes our configuration once disconnected. Kept in UserDefaults; `takeDownLeftOver` does it at launch and on coming
  back. Not removed when ours is no longer enabled (another VPN already has the checkmark).
- Decision: a start within 5 minutes of a removal also counts as owed. Tailscale can need minutes to come back; a
  second install before that would otherwise keep the checkmark for good. The phone check hit exactly this (below).
- Also removed when an install pauses with the app left (B423), since the VPN goes off then and nothing holds it.
- `installroute-b357.test.js` asserted the source has no removal: now exactly one, behind `owed`.

## iPhone 15 Pro (iOS 27, Tailscale On Demand, 11:08-11:18)

Phone because it is NETunnelProviderManager and iOS's Allow. Driven by bridge calls over webinspector cdp.

- On, no other VPN: `vpn.test`, nothing removed (Settings > VPN keeps ours, checked).
- Off, Tailscale up: `vpn.test`, nothing removed, Tailscale stays off.
- On, Tailscale up: `vpn.test`, ours gone from Settings > VPN, Tailscale checked and Connected within about 15 s.
- On, Tailscale up, a real install (test IPA through `signing.install`): Allow asked again; installed 11:15:49, off
  11:15:53, configuration removed 11:15:53.
- 17 s later, Tailscale not back yet: started again ("isn't back yet: restoring it after"), app killed with the VPN on;
  a minute later ours was still checked. Relaunched 11:17:34: removed at once, Tailscale Connected.
- Put back: setting off, test app removed, Tailscale on. The branch's build is left on the phone.

## Spec review

Fixed: the wait until disconnected is 10 s when a removal is owed; the second `manager()` records too; a stop on the
main thread never waits for `startLock`; an owed flag with no configuration left is cleared; `setRestore` and
`noteOther` share `lock`; the removal's time limit is 30 s. Kept: the 5-minute rule (above).

## Not verified

- A carrier's Wi-Fi calling tunnel with an IPv4 address counting as another VPN (`otherVPNUp`'s existing rule): no SIM.
- The removal during a B423 pause, and several rows at once, on the phone.
- A `removeFromPreferences` that takes over 30 s: it could still land after a new start's save.
- A VPN with no On Demand: it gets its checkmark back, but nothing reconnects it.

`setRestoreVPN` (web/app/core/installroute.js) is there because the gate wants a page caller for every bridge call
(test_bridge_contract); F412 builds its switch on it. Its first gate run failed on that.
