# F388: Install Switch only when needed

## Summary

Before, the first connect of every queue of installs on This iPhone ran the Install Switch, so the screen went to
Shortcuts and back each time. Now the start runs it only when it is needed: on cellular, or when another VPN is up.
On Wi-Fi with no other VPN, the app turns iFizBox VPN on and off by itself and Shortcuts never opens. The phone check
covered the Wi-Fi case and the Tailscale case through `vpn.test`. A real install on Wi-Fi was not run.

## What I did

- `native/sideload/vpn/App/LocalVPN.swift`: `begin()` checks `switchNeeded(cellular:otherVPN:)` and `otherVPNUp()`.
  The Install Switch runs only when the phone is on cellular or another VPN is up. Otherwise it logs
  "Install Switch: not needed (not on cellular, no other VPN up)". `otherVPNUp()` counts a VPN as up when a tunnel
  interface (utun, ipsec or ppp) has an IPv4 address outside 10.7.0.x.
- `vpn.test` follows the same rule. `vpn.testSwitch` (Test Install Switch) still always runs the Shortcut.
- `installation/shortcuts` (Install Switch page): the footer under its Add row now ends "It opens Shortcuts only when
  needed: on cellular, to turn data off and on, or to bring back your VPN."
- `docs/sideload.md` (Built-in VPN): the first connect's rule is stated, and the other-VPN reason is given there.
- `release-notes/F388.md`: one user-facing sentence.

Decision: the task asked for "run the Shortcut only on cellular", on the assumption that the app already puts the
previous VPN back on Wi-Fi. That assumption is wrong. Our configuration keeps Settings > VPN's checkmark, so an
On Demand VPN such as Tailscale does not reconnect by itself (see `journal/2026-11-22-f372-builtin-vpn/notes.md`).
Running only on cellular would leave Tailscale off after every Wi-Fi install. So the rule is "cellular or another VPN
up". The user's own case (Wi-Fi with Tailscale on) still goes through Shortcuts and back. No app API avoids that. The
only other way is removing our VPN configuration after each install, which makes iOS ask "Add VPN Configurations"
again at every install.

## Checked on the iPhone 15 Pro

iOS 27, Wi-Fi, build 0.24.1 (4662) installed with `tools/ui-15.sh`. The bridge was called through pymobiledevice3
webinspector CDP, and the syslog was read with `ios syslog`.

(a) Tailscale off. `idevice.status` had no tunnels and `otherVPN` was false. `vpn.test` answered
`{ok:true, kind:"rp", ms:133}`. Syslog: "Install Switch: not needed (not on cellular, no other VPN up)", "vpn: on in
0.16 s", "vpn: off". No Shortcuts run.

(b) Tailscale selected by hand in Settings > VPN and turned on. The checkmark had been left on iFizBox VPN from
earlier tests, which is the known problem. With Tailscale on (utun4, 100.109.186.91), `vpn.test` answered ok in 135 ms.
Syslog: "Install Switch: start ran", "Install Switch: end ran". Afterwards Tailscale was connected again (utun4,
100.109.186.91). So in this case it still goes through Shortcuts, by design.

## After the phone test

The "not needed" log line printed twice in (a). It now prints only at a queue's first hold. This is a log-only change.
That build was not put on the phone again.

## Not verified

- A real app install (`signing.resign`) on Wi-Fi. Only `vpn.test` ran. It goes through the same
  `LocalVPN.begin`/`end` as an install, but that was not seen end to end.
- Cellular: the iPhone 15 Pro has no SIM data here ("SOS"), so cellular behaviour was not tested. The code path for
  cellular did not change.
- A VPN that is selected but idle, with no utun address (On Demand waiting), counts as no other VPN. So after an
  install it would stay off. Not seen, not tested.

## For a person to decide

Whether Wi-Fi with Tailscale should also skip the Shortcut. If it does, Tailscale stays off after installs, as the
F372 note describes.
