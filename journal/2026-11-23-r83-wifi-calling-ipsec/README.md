# R83: does a Wi-Fi Calling ipsec tunnel count as another VPN?

## Finding

Undetermined here. `LocalVPN.otherVPNAddresses()` (native/sideload/vpn/App/LocalVPN.swift) counts any up `utun*`, `ipsec*` or
`ppp*` interface with an IPv4 address outside 10.7.0.x. Whether iOS exposes the carrier's Wi-Fi Calling tunnel
(an `ipsecN` interface to the carrier's gateway) to an app's `getifaddrs`, and whether it has an IPv4 address,
could only be read on a phone with a SIM and Wi-Fi Calling on. The only test phone (the 15 Pro) has no SIM
(see journal/2026-11-23-f394-install-switch-one-trip), and the user's phone is not ours to test on.

What the code already does: the end (`switchEndNeeded`) is safe, since it needs every address from before the start
to be back, so a tunnel that stays up never opens Shortcuts. Only the start (`switchNeeded`, `otherVPN`) and the
page's "Your VPN Stays Off" wording (`st.otherVPN`) would be wrong if the carrier tunnel counts.

Options if it does count: (1) drop `ipsec` from the prefixes, which also misses a Settings IKEv2 VPN; (2) keep it and
accept an extra Shortcuts trip on a Wi-Fi Calling phone. Neither is chosen without the interface list, so the next
step is a log line that records it (filed below).

## Filed

- A follow-up that logs every up tunnel interface (name, family, address) with the start's decision, so one install
  on a SIM phone with Wi-Fi Calling on settles this.

## Not verified

- Everything about the carrier tunnel: no phone with a SIM here, so no interface list was read.
