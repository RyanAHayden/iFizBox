# T77: log the up tunnels at an Install Switch start

## Summary

Follows R83 (journal/2026-11-23-r83-wifi-calling-ipsec). When a queue's start decides on the Install Switch, the app
now logs what it decided from, so one install on a SIM phone with Wi-Fi Calling on shows whether the carrier's ipsec
tunnel counts as another VPN. The log stays on the phone; nothing is uploaded. Users see nothing new, so there is no
release note.

## What changed

- `native/sideload/vpn/App/LocalVPN.swift`:
  - A queue's start (the first hold, with the Install Switch not already on, or a start that runs) logs one line
    through `LocalVPN.log` (os_log):
    `Install Switch: start <bool>, added <bool>, cellular <bool>, another VPN <bool>; up tunnels: <name family address, ...>`
    It is written without the Install Switch added too. `none` is written when no tunnel is up.
  - `tunnelAddresses()` lists every address entry of the up `utun`, `ipsec` and `ppp` interfaces: IPv4 and IPv6 with
    the address, a link entry as `link`, and any other family as `family N`. It includes ours (10.7.0.x) and iOS's own.
  - `otherVPNAddresses()` now filters that same list, so the log and the decision share one snapshot. The rule is
    unchanged: IPv4, not 10.7.0.x.
- `native/sideload/vpn/test_vpn.py`: checks for the list and the log line.

## Decision on ipsec

`otherVPNAddresses()` keeps counting `ipsec` for now. Dropping the prefix also misses a Settings IKEv2 VPN, and there
is no reading yet of what the carrier's tunnel looks like on a phone. The decision waits on the log from a SIM phone
with Wi-Fi Calling on. That follow-up is R84 (`plan add`, after T77, later).

## Not verified

- The carrier tunnel on a SIM phone. The 15 Pro has no SIM, and the user's phone is not ours to test on.
- The log line was not read on any phone.
