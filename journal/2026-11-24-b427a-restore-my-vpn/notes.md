# B427a: Restore My VPN

## What I did
- native/sideload/vpn/App/LocalVPN.swift: the Restore My VPN removal runs once nothing uses our configuration (at launch, on return, on the switch, after a background end), retries 3 times 10 s apart, and stops the tunnel of the configuration it found. Logs say what was decided and why.
- native/sign/SignJob.swift: `SignJob.anyGoing` counts a signed app's jobs as use, up to 15 min.
- native/sideload/vpn/test_vpn.py: tests for the above.
- Quiet Pairing Check is skipped with the switch on, because iOS would ask Allow at each daily check (web/app/core/installroute.js, installroute-b316.test.js, installroute-b357.test.js).
- docs/sideload.md, GLOSSARY.md, release-notes/B427a.md.

## Finding (iPhone 15 Pro, iOS 27.0, Tailscale On Demand on)
- Saving or enabling our configuration makes iOS disable the other VPN's configuration ("Configuration was disabled"). A disabled configuration's On Demand does nothing.
- Removing ours does not enable the other one again. It stayed off over 5 minutes with the phone awake, also after a web request, after opening the Tailscale app, after Airplane Mode on and off, and with Settings' root page open.
- Opening Settings > VPN turned it back on: the Settings app saved the Tailscale configuration enabled and it connected within about a second. This happened 3 times. So an earlier "Tailscale came back" was caused by opening Settings > VPN to look.
- The app cannot enable another app's configuration. The private `grade` of our NEConfiguration reads 1 and has no setter (setGrade: is missing); a scratch build tried it and it was dropped.
- What this fixes: with the switch on, our configuration no longer stays after a check or an install.
- What it does not fix: the other VPN does not come back by itself until Settings > VPN is opened.

## Phone checks
- Switch turned on with ours idle: removed in 0.1 s.
- A check; a check with Home pressed 1.7 s after.
- A real install of the Probe app through library.install, with Home pressed in the linger: removed 2 s after.
- Airplane Mode turned on during the linger: removed.
- A failed check with no network and Don't Allow: "no configuration to remove".

## Problems met
- The first syslog capture died at 14:48.
- Two Airplane Mode tries were confounded by Settings; they were redone from Control Center.
- Some taps were missed.

## Spec review
- Fixed: silent returns; a retry stops the found configuration's tunnel; no background hold during a pause; the release note.
- Kept: the Quiet Pairing Check skip; signing jobs count as use up to 15 min.

## Suspects from the task
- noteOther was one real cause of ours staying.
- giveBack on the main thread was one cause too. It is now off the main thread, but I never saw it happen again.
- After Airplane Mode the removal itself works.

## Not verified
- A pause with the app left keeping the configuration (code only).
- A queue of several apps, and the 5 s wait while a download runs.
- Real cellular (no SIM).
- Retries of a failed removal.
- Allow tapped after 90 s.
- The background task's early end.
- A signed app waiting only for Confirm with no job running is not counted as use.
- A check that fails after the VPN came up.
- Connecting Tailscale with its own Connect button.
- Two or more other VPNs (which one Settings picks).
- Removal inside the app when the app is killed.

## Phone put back
- Setting off; Probe uninstalled; Tailscale connected; this branch's build left installed.

## Follow-up
- B427b: the footer must not say the other VPN reconnects.
- R99: find a way to keep the other VPN enabled, or to bring it back without a person.
