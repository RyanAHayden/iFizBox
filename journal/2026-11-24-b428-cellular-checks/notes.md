# B428: cellular checks, closing session

B428 was split into two tasks, both in this branch's base:

- B428a, web: `journal/2026-11-24-b428a-check-on-cellular`
- B428b, native: `journal/2026-11-24-b428b-vpn-network-wait`

This session changed no product code. It re-checked the two together.

## Screenshots

1. IMG_2354, "iPhone Refused" with Not Now / Fix on cellular. Now it is "Can't Check on Cellular", with OK only, shown before connecting.
2. IMG_2355, "iFizBox VPN Didn't Start" with LTE shown. The start now waits up to 8 s for a network.

Read in code, together: with no network at the check, cellular comes back during the wait, the connect is refused, the status is read again and says cellular, so the cellular alert shows.

## Checks

- `node --test web/app/screens/installroute*.test.js`: 127 pass.
- `native/sideload/vpn/test_vpn.py`: 18 pass.
- No new release note. B428a already has one.

## Not verified

- Real cellular. The test 15 Pro has no SIM.
- The combined sequence was read in code only, not run.
- A VPN start that times out after 8 s still shows "iFizBox VPN Didn't Start" with the no-network text. This is the real no-network case and is deliberate.
