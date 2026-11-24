# F410a: Home says Pair This iPhone

## What was done

- **Core** (`web/app/core/installroute.js`): `needsPairing(choice, st)`, true when Install Apps With is This iPhone and
  `idevice.status` answered that the iPhone isn't paired. No VPN is needed to know it.
- **Home** (`web/app/screens/home.js`): `PAIR_TILE` (amber, "Pair This iPhone" / "Installs use the server until then",
  opens Settings > Installation > Pair). `routeTile` shows it before a Route Failure tile; a signing problem that stops
  all installs (Signing Needs Setup) stays first. `phoneStatus` asks `idevice.status` and `readPhone` keeps the answer
  apart from the slot's check, so a slow Signing Server doesn't hold the tile back. The answer is read at launch, when
  Home or the app comes back, and when Install Apps With changes. An answer that fails shows nothing.
- **Tests**: `web/app/screens/home-b316.test.js` (node), with `core/installroute.js` tests; 20 pass.

## Checks

Chromium at 320pt with f372's `capture.mjs` (`journal/2026-11-22-f372-builtin-vpn/capture.mjs`) and the sideload fake
bridge: `home.jpg` shows the tile, and its subtitle is not cut (scrollWidth = clientWidth). Tapping it opened
settings/installation/pair. Going back with the iPhone paired hid it. A `visibilitychange` with the iPhone unpaired
showed it again. A Signing Server route hid it.

## Decisions
- The review asked about precedence; kept as the route tile already had it: a signing problem that stops every install (setup, expired, Signing Server down) stays first, and a coming expiry gives way to Pair This iPhone.
- At a cold launch the tile waits for the slot's first answer (seconds when the Signing Server is down), so it doesn't flash before Signing Needs Setup.
- idevice.status has no deadline here: if it hangs, Home keeps the last answer.
- In home.jpg the Lite icon is a broken image: the fake shell doesn't serve it.

## Not verified
- The repaint wiring in certRow is checked in Chromium; the node test for it only reads the source.
- A real iPhone. This is a web-only change; the phone is for what Chromium can't check (AGENTS.md).
