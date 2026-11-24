# B427: restore my VPN

Parent of B427a (the native bug) and B427b (the footer). Both are on this branch's base. R99 researched the rest:
journal/2026-11-24-b427a-restore-my-vpn, journal/2026-11-24-B427b-restore-footer and
journal/2026-11-24-r99-keep-other-vpn-enabled.

## Problem

After installs, Restore My VPN removes our VPN configuration, and the other VPN (for example Tailscale) stays
off. iOS leaves it disabled, and the app cannot switch it back on.

## What this session checked

No code changed. `native/sideload/vpn/test_vpn.py` passes (23 tests) and
`web/app/screens/installroute-f372.test.js` passes (11 tests). The code and docs (LocalVPN.swift,
core/installroute.js, docs/sideload.md) agree with the findings in those three entries.

## Conclusion

The bug is still there. The only automatic way found is a Shortcut's Set VPN. R99 showed it works (tried with
Tailscale only), but C72 removed Shortcut VPN switching as product behaviour after the user said it does not work.

The person chose Add a Shortcut on 2026-11-24: a Shortcut's Set VPN switches back to their VPN after installs, and
our configuration stays. That is queued as R100a and R100b (phone check), then F418, F419, F420; nothing of it is
built here. B427 closes with what B427a and B427b landed; until those tasks land the other VPN still comes back only
once Settings > VPN is opened.

## Not verified

- Which VPN the user has, and whether it uses On Demand.
- Real cellular: the 15 Pro has no SIM.
- A Shortcut that needs only one trip per queue (an idea only).
- No phone check was run this session. B427a and R99 ran theirs the same day.
