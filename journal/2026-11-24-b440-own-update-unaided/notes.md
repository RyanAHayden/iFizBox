# B440: iFizBox's own update finishes with no swipe

Evidence files beside this note: evidence.txt, here-first-build.txt, here-10.txt, hosted-10.txt.

## Cause

Measured on the iPhone 15 Pro, iOS 27, before the fix (evidence.txt).

- On This iPhone the own update installs as a plain package. installcoordinationd asks iFizBox to terminate and the ask fails with RBSRequestErrorDomain Code=5: a busy plugin, com.ryha.ifizbox.vpn (our VPN extension). The asks repeat about every 6 s (12.6, 18.6, 24.6, 30.7, 36.7 s past 23:44). iOS goes on after 900 s of asks.
- After iFizBox exits, the VPN extension runs on until PacketTunnelProvider.quietLimit (60 s).
- Run 1 (not in evidence.txt): iFizBox exited 23:35:35.6 with the VPN still up; the update completed 23:36:33.7, about 58 s later, with no swipe.
- Run 2 (evidence.txt, "before" block): the old copy was reopened about 8 s after the exit (exit 23:44:22.581; first line of pid 1303 at 23:44:30.677). It turned the VPN off itself at 23:44:30.677. The next ask at 23:44:36.7 was refused ("Target process has a higher te...", line cut off), no asks followed, and the update sat until the process was ended by hand at 23:49:34.9 (not in evidence.txt), then completed at 23:49:37.0 (not in evidence.txt). The earlier note's launch time of 23:44:32 does not match the log; the log line is 23:44:30.677.
- This matches the user's report. The user's own phone log was not available, so this is the mechanism that matches, not proof of their runs.
- Suspects checked: the exit was reached (yes, 23:44:22.581); a background relaunch holding the process was not seen; PackageType was not the cause and is unchanged (the log says "package type plain").

## Fix

- closeWith turns the VPN off first (LocalVPN.downToClose, in the new VPNClose.swift). A flag blocks new VPN starts while closing.
- It holds KeepAlive, then exits 6.5 s after the VPN goes off (vpnAsk), when the VPN had been up. iOS asks once with the VPN already off, and iFizBox goes on the moment it exits; iOS blocks launches meanwhile.
- With no VPN up, the exit is as before (2 s / 0.6 s delays).
- The backstop timers are longer and also take the VPN down.
- The own update stays a plain package type.
- Cost: on This iPhone, "Closing" shows about 5 s longer.

## Phone tests

Not run in Chromium: the test needs real installd and the VPN.

- First build (before downToClose moved into its own file; same logic): 9 of 9 (4 front, 4 home, 1 reopen; here-first-build.txt). Complete 1.9 to 2.3 s after exit. Run 10 was invalid because the syslog tool hung, so the streak restarted on the final build.
- Final build, This iPhone: 10 of 10 (here-10.txt): 3 front, 3 home, 4 relaunch attempt right after exit. Complete 2.0 to 2.3 s after exit. The relaunches were refused by iOS ("installing or uninstalling, and cannot be launched"); at least 2 are logged, and it was not counted whether all 4 were refused.
- The exit came 6.88 to 6.93 s after the "off" stamp in both builds (here-10.txt, here-first-build.txt). The code timer is 6.5 s; the timer fires up to 0.4 s late (leeway).
- Signing Server route (node worker over tailscale serve; hosted-10.txt): 10 of 10 (4 front, 3 home, 3 reopen). Complete 4.2 to 5.0 s after exit; busy=0 and refused=1 on each run. This route was not affected by the bug, and no before-run of it was made.
- Home runs: Home about 1 s after the call (not in the evidence files).
- Every This iPhone run first re-installed the rig-signed build, because the in-app signing profile on that phone lacks Network Extensions; the update installed has no VPN.

## Failed tries

- URL download failed after our VPN took Tailscale's place (DNS). Switched to library.install with a file in Documents.
- A rig reinstall while an update is stuck is refused silently; the run script hid that.

## Left on the phone

- Final build rig-installed.
- Test IPA removed.
- Tailscale turned on again.
- Lock released.
- tailscale serve entries off.

## Not verified

- The user's phone.
- Signing Server with our VPN up at the same time (our VPN takes Tailscale's place, so the test server was unreachable).
- iOS older than 27, and whether its retry is 6 s.
- The process being killed or suspended before the close (then the extension's 60 s quiet period applies).
- Staging slower than 10 s.
- Lockdown pairing.
- Tests with Developer Mode off.
- Own updates whose new copy has the VPN extension working (the in-app profile here lacks Network Extensions).
- The last edit, made after the phone runs: the VPN is taken down once more right at the exit, for a start already going on (compiled only; it returns at once when the VPN is off).
- The backstop exits without waiting for iOS to ask again, so it keeps the few seconds where a reopen can stick.
- Run 1 and the end of run 2, and the Home-run timing: their numbers are not in the evidence files.

## Spec review

Fixed: the second take-down at the exit. The other findings were evidence not committed yet when it ran.

`blocked.test.js` began to fail at midnight (a fixed date left the Changes window); same one-word fix as main has.
