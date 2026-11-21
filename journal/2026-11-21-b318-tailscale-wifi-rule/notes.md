# B318 Tailscale installs only on Wi-Fi: say the rule

R70 found that iOS takes RemotePairing (49152) and lockdownd (62078) from the network only on Wi-Fi (user's phone,
through Tailscale: every port refused on Verizon cellular, both open on home Wi-Fi).

## Done

- `web/app/core/installroute.js` routeRefused (Tailscale): the message is now the rule: "This iPhone takes installs
  through Tailscale only on Wi-Fi: on cellular, iOS refuses every connection, so it isn't the pairing. Join Wi-Fi, or
  use the Signing Server." Short: "Tailscale installs need Wi-Fi. Join Wi-Fi, or use the Signing Server." (69 chars,
  fits the 70-char two-line rule). The comment above it says why.
- Title, fix and button (Tailscale Refused / Open Tailscale) kept: the task asked only for the wording, and the
  Signing Server Fallback (F366) already offers Use the Signing Server beside the alert.
- `installroute-b316.test.js` asserts the new message and short line, and that the hedge is gone.
- `docs/sideload.md` This iPhone over Tailscale: the phone must be on Wi-Fi; on cellular iOS refuses every port.
  It does not claim "any Wi-Fi with internet" (R70 review: only home Wi-Fi was measured).

## Tried and failed

none

## Not verified

- Wi-Fi other than the user's home Wi-Fi (public, hotspot, captive portal, another phone's hotspot): R70 measured
  only home Wi-Fi, so neither the docs nor the message promises them.
- Cellular on carriers other than Verizon, and other iOS versions: one session on one phone.
- The alert on a phone: wording-only change, checked by node --test; no device run (the user's phone is the only
  one that hit this, and real-device checks don't go to the user).
