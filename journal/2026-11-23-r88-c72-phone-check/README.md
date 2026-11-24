# R88: C72 on-phone check (15 Pro, Wi-Fi)

## What
C72 holds on the iPhone 15 Pro over Wi-Fi, with Tailscale on and with no VPN on. Both installs finished, Shortcuts never came to the front, and our VPN was off afterwards.

Phone: iFizBox 0.28.0 build 5202. V19 (build 5117) contains C72's commit 16322adf, and 5202 is newer.

Earlier attempts ran nothing. R87, F408, B415, B423 and R89 each held the phone's UI lock, so the check was blocked. The fifth attempt (2026-11-24, 11:23 to 11:40) got the lock and ran the check.

## Tried
Test app: the existing Probe IPA (com.ryha.ifizbox.probe), installed with Install then Confirm, driven with tools/ui-15.sh. WDA /wda/activeAppInfo was polled about every 1.5 s during each run.

- Run 1, Tailscale on (2026-11-24, started 11:32:50). The Tailscale node iphone-15-pro-1 was online before the run. Connect On Demand is ON for Tailscale (Settings > VPN > Tailscale info). The install finished within about 10 s ("iOS installed Probe 1.0", "1 installed", Return to iFizBox button). The frontmost app was com.ryha.ifizbox the whole time, never Shortcuts. The Tailscale node went offline at 11:33:06, because iOS drops it while our VPN is up. Afterwards Settings > VPN showed iFizBox VPN selected but Not Connected.
- On Demand watch, 11:33 to 11:37 (about 4 min, Settings in front, Wi-Fi unchanged). Tailscale did not come back by itself. The desktop status stayed offline or idle, Settings showed Not Connected, and both VPNs were off.
- Run 2, no VPN on (the state run 1 left; started 11:37:14). Same result: install finished, frontmost app always iFizBox, never Shortcuts, Settings VPN Not Connected afterwards.
- After run 2, Tailscale was turned back on by hand in Settings (node online again), and the phone's UI lock was released.

## Failed
- Connect On Demand did not restore Tailscale within about 4 min, even though it is switched on. Probably no network change or rule triggered it. Not investigated.

## Not verified
- Cellular installs: the phone was on Wi-Fi only.
- On Demand beyond 4 min, or after a Wi-Fi change or a screen lock.
- Shortcuts was never opened, as far as the activeAppInfo polling (1.5 s samples) and the Log screens show. Between samples, a brief switch is not ruled out.
- Only a tiny 59 KB IPA was installed, so a long install (iOS background grace period) is untested.
- No screenshots are committed; the recorded set (ref/15/screens) is local only.
