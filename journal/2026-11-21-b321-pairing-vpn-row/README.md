# B321 Pairing page: the VPN row names Tailscale while pairing

## What I did
- `web/app/screens/installroute.js` drawPair: in pairing mode it doesn't read idevice.status again (st = null), so
  setupGroups' VPN row fell back to "LocalDevVPN". It now gets `st ?? cachedStatus()` while pairing, so the row
  names the VPN from the last answer (Tailscale when that is the way in). With no answer yet it still says LocalDevVPN.
- `web/app/screens/installroute-pair.test.js`: a test that draws the page with a Tailscale status, lets the
  pairing start, and checks the row says Tailscale, not LocalDevVPN; plus the pure fallbacks.
  It fails without the fix ("rows: LocalDevVPN") and passes with it.

## Tried and failed
none

## Not verified
- Not looked at on the iPhone 15 Pro: the change is web-only and node --test covers the row; a phone check
  would need a pairing started over Tailscale, which this unattended run left alone.
