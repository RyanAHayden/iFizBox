# R98: overlapping installs on the iPhone 15 Pro

## Did
- iPhone 15 Pro via `tools/ui-15.sh`, 2026-11-24 about 15:00-15:06, over Wi-Fi.
- Built the Lite IPA from this branch (main with F416) with `make -C native ipa`, installed with `ui-15.sh install`.
- Made 3 test IPAs from the `tiny-ifizbox.ipa` fixture, bundle IDs `com.ryha.ifizbox.r98a`, `r98b`, `r98c` (never iFizBox's own ID), each with 100 MB of random padding. Put them in the app's Documents with `afcclient`.
- In the app: Install IPAs > each IPA's page > Install (queues, shows Q'd) > Continue Queuing, three times, then Installed > Queue > Confirm. Not Manage > Sign and Install.
- Syslog captured with `pymobiledevice3 syslog live -e iFizBox`. The native `iFizBox install:` lines are in it.
- Run 1: fresh install of the Lite build, so the VPN configuration did not exist yet.
  - All 3 rows showed Connecting to iPhone together. iOS asked "Would Like to Add VPN Configurations" once; tapped Allow.
  - All 3 rows showed "Copied to iPhone, waiting for iOS" at the same time.
  - Log: Copying a/b/c started back to back, then Installing b, Installing c, Installing a, "iOS installed" for each, then "3 installed".
  - Syslog VPN lines: `step: turning on iFizBox VPN` x3 (15:02:05.010, .339, .595, one per row, 0.3 s apart); one `vpn: saving a new configuration (iOS asks to allow it)`; one `vpn: on in 0.32 s` (15:02:26); one `vpn: off (nothing left to do)` (15:02:41). Zero lines containing `stale`.
- Run 2: same 3 IPAs, now Signed and queued as Reinstall. The iFizBox VPN configuration was already the selected one.
  - Rows showed Copying to iPhone 93% / 90% / 88% at the same time; then "3 installed".
  - Syslog: `turning on iFizBox VPN` x3 within 0.7 s (15:05:18.218, .546, .898); one `vpn: on in 0.16 s`; one `vpn: off (nothing left to do)` (15:05:34). Zero `stale`.
  - Log line: "Connected to iOS through iFizBox VPN (RemotePairing tunnel) after 0.2 s".
- State left: the 3 test apps are uninstalled. The IPAs, their signed copies and `.json` files are removed from the app's Documents and Library/Application Support/MyIPAs. The UI lock is released. The Lite build of this branch stays installed. The iFizBox VPN configuration is now saved on the 15 and selected in Settings > VPN, so Tailscale needs selecting again by hand if wanted (not checked by screenshot).

## Result
- The app run overlaps This iPhone rows: 3 at once, HERE_PARALLEL. This confirms R97's reading: the overlap comes from the page Install + Confirm path, not from Manage > Sign and Install (that is F416's change, which was not run here).
- B418 held: one VPN start for the 3 overlapping rows, no `stale` lines, no failed row, VPN off after the run.

## Not verified
- The line "enabling the configuration" never appeared in either run. It logs only when the configuration exists but another VPN (e.g. Tailscale) is the selected one. Run 1 saved a new configuration instead, and run 2 found ours already selected. Covering it needs Tailscale selected in Settings > VPN before a run (R90 saw that line once).
- F416's Sign and Install route was not run.
- 250 MB IPAs and real cellular were not run (the 15 has no SIM).
- The stale retry itself is still unproven: no stale error occurred.
- The 3-row overlap was seen by screenshot and syslog, not by timing instrumentation.
