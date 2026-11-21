# R53: This iPhone install in the background, with drops (iPhone 15 Pro)

The first attempt (same folder, earlier today) blocked with a CONFIRM for the user's own phone. The user answered:
run it on the iPhone 15 Pro with `tools/ui-15.sh`, use stand-ins where the 15 lacks something, and block only for
a login. No login was needed: the app was still signed in to Tailscale (`ifizbox-on-iphone-4`) and paired.

## Setup

- Lite built from this branch (main d274bfd1, 0.18.4 (3695)) with `native/build.sh ipa`, installed with
  `tools/ui-15.sh R53 install` (rig signer). Before any run, through Web Inspector: `idevice.verify` =
  `{ok: true, kind: "rp"}`, `tailscale.status` signed in, `signing.status` the team's ad hoc identity,
  `idevice.status` `localDevVPN: false` (LocalDevVPN is not installed; only the Tailscale route could run).
- Test IPAs: `mkipa.py` (here) builds `com.ryha.r53test` ("R53 Test", never launched): the Tiny fixture's
  executable plus 340 MB of random padding, 356.5 MB, versions 2.0 / 3.0 / 4.0. Put in the app's Documents with
  `afcclient --container`; each run picked a version other than the installed one, except runs 8-9 (same version).
- Each run: Install IPAs > row > INSTALL (two taps) > Replace > Confirm, then a script (`actions.txt` has its
  timestamps) waited for the copy's first AFC line in the phone log and did the run's action. Evidence: the app's
  os_log `iFizBox install:` lines from `pymobiledevice3 syslog live` (`install-log.txt`), Tailscale's own log lines
  for run 2 (`run2-stall-tailscale-log.txt`, public IP redacted), screenshots in the main checkout's
  `ref/15/screens/r53-*.png` (not committed).
- Copy speeds are the app's "AFC: copied … : X MB/s in front, Y MB/s in the background" line.

## Runs (340 MB copy each, Tailscale direct over the LAN, iOS 27.0.1)

| Run | Version | What I did, ~4 s into the copy | Copy | Result |
| --- | --- | --- | --- | --- |
| 1 | 2.0 (new) | Voice Memos, recording for 30 s (stand-in for an app that takes the audio session) | 20.1 s: 18.1 front, 16.5 background | installed, 25.7 s in all |
| 2 | 3.0 | Camera opened, two photos (I meant video: Camera always opens in Photo mode) | **stalled at 78 MB as the app went to the background**; no answer for 30 s, then the drop was caught, reconnected 3.4 s later (2 s pause, then node and tunnel), "carrying on from 78.0 MB"; 62.7 s in all | installed (connection 2) |
| 3 | 4.0 | Camera opened, no capture | 21.8 s: 17.5 front, 15.0 background | installed |
| 4 | 2.0 | Camera, tap on VIDEO, then recording for 30 s (the mode switch wasn't screenshotted) | 23.2 s: 16.9 front, 14.0 background | installed |
| 5 | 3.0 | Camera opened, two photos (run 2's exact steps; `actions.txt` still says "switch to Video", the script's fixed label, but this run skipped that tap, `VIDEO_TAP=0`) | 23.0 s: 16.8 front, 14.2 background | installed |
| 6 | 4.0 | phone locked for 15 s; the copy ended before my VPN tap (missed, below) | 22.2 s: 16.2 front, 15.1 locked | installed |
| 7 | 3.0 | iOS Settings, VPN off at 94 MB, on again 16 s later | drop noticed 14 s after VPN off (`upload_failed: Socket(Kind(TimedOut))`, try 1 of 4); try 2 "Tailscale isn't back on yet"; try 3 (in the background) reconnected and carried on from 94.0 MB; 40.8 s in all; summary "17.5 front, 13.0 background" (the background figure counts the dead time, B293) | installed (connection 3) |
| 8 | 3.0 over 3.0 | VPN off at 334 of 340 MB, on again 19 s later | drop during the copy; tries 2-3 "isn't back on yet"; try 4 carried on from 334.0 MB | installed (connection 4) |
| 9 | 3.0 over 3.0 | VPN off the moment the copy ended (installd started), on again 24 s later | "installd quiet for 30 s: asking iOS for com.ryha.r53test 3.0 on a second connection"; "second look: iOS lists com.ryha.r53test: 3.0 (3.0) in 962051F2… -> installed" | installed |

Every run ended "installed"; the progress page said "1 installed" with the drop and the resume in its Log (runs 7-8
screenshots `r53-24`, `r53-27`). No run logged "the app was suspended", and KeepAlive logged no interruption.

### Same-version reinstall and Browse's `Path`

Browse returned the bundle folder every time ("before the install, iOS lists … in <folder>"). Same-version runs:
run 8 3.0 over 3.0 in 83849DD8… → next "before" lists 21870960…; run 9 3.0 over 3.0 in 21870960… → 962051F2…,
and run 9's verdict came from that rule (same version, new folder → installed) after a drop during installd.

## Findings

1. **An app that takes the audio session does not stop KeepAlive here.** With Voice Memos recording (run 1) and
   Camera recording video (run 4), the app's audio session saw only "SomeOtherNonAmbientSessionIsPlayingDidChange"
   and route/format changes, no interruption (`audio-session-log.txt`, from the phone log; the only "became
   inactive" in run 4, at 12:05:23, has "Source: App": KeepAlive let go itself after the install): KeepAlive's session is `.playback` with `.mixWithOthers`, and iOS lets
   another app's session start beside a mixable one without interrupting it. The background copy kept going at
   14-17 MB/s against 17-18 in front (82-95 %) in every run without a drop, the same as Home Screen or locked
   (B246, R55).
2. **The one slow install (run 2) was a Tailscale path loss, not iOS stopping the app.** Timeline
   (`run2-stall-tailscale-log.txt`): 11:59:33.70 the app went to the background (Camera opening); 11:59:33.94 the
   phone's Tailscale node started a new WireGuard handshake and the app answered; from 11:59:35 remotepairingd
   retransmitted inside the tunnel; 11:59:39.94 the phone's node was reached "via=derp" (no longer direct); from
   11:59:48.99 "stopped hearing back after 15 seconds", and handshake retries every 5 s went unanswered. The app
   kept running all along (the copy's 30 s watchdog fired on time, KeepAlive held, no "suspended" line). B246's
   drop handling then did its job: TIMEOUT at 30 s, the stuck call left after 10 s, a fresh node 2 s later went
   direct at once (udp=true) and the copy resumed from 78 MB. Cost: about 42 s. The same steps (run 5) and Camera
   in other ways (runs 3-4) did not repeat it: 1 stall in 7 background runs. The phone's node also starts a new
   handshake about 5 s into every install (runs 4-5 too), so the handshake alone isn't the cause. During the stall
   the app's own node (tsnet) also reported "UDP is blocked" and `udp=false` (11:59:52, 12:00:02), which would fit
   tsnet's UDP socket being cut while the app was in the background; but tsnet logged the same "UDP is blocked" in
   run 4 at 12:04:43 with the app in front and the copy unharmed, and in front again at 12:00:19-24 while the
   resumed copy ran at full speed, so it is not conclusive. "tsnet in the background" stays a candidate. Why the
   direct path broke that once is not known (the phone's Tailscale extension logged no restart; my unfiltered capture
   started only after run 2).
3. **Drops resume and reconnect in the background.** Run 7's reconnect and resume ran with Settings in front. A
   drop during installd ends "installed" in about 30 s through the second look (run 9), as B251 meant.
4. So for the user's slow install: on this phone, background copies are not much slower than in front, and the
   only real slowdown seen was a Tailscale path loss, which costs ~42 s before the reconnect. If the user's phone
   loses the direct path more often (a DERP-relayed or flakier network), each loss costs that much. Filed B292 to
   notice it sooner. The summary line also hid that stall (run 2's summary gives only "17.7 MB/s in front") and
   counted VPN-off time as copying in run 8 ("8.4 MB/s in the background"): filed B293.

Small things seen on the way:
- The IPA page's footer says "Installing needs a connection only for the Signing Server's install manifest." with
  This iPhone as the route: filed B294.
- After a failure the app relays idevice's last 30 log lines, which repeat every earlier install's
  "browse didn't contain current list" warnings since the app started (noise in the log, by design of
  `relayLibraryLog`; not filed).
- The 15 Pro now has an Apple Account signed in (Settings shows it) and iOS shows "Finish Setting Up iPhone" and an
  "Optimizing Search and Siri" row in Settings, which moves the VPN switch down. docs/iphone15.md still says it has
  no Apple ID; not changed here (research task, docs are outside its files).

## Tried and failed

- Run 2 was meant as Camera video recording: Camera always opens in Photo mode, so my "Record" tap took a photo.
  Run 4 redid it with a tap on VIDEO first.
- Run 6's VPN taps missed: Settings had gained a row and an alert, so (994, 2150) was no longer the VPN switch. The
  VPN stayed on; runs 7-9 used the new position, each state checked by the switch's pixel.
- The desktop's usbmuxd restarted at 12:08:35 (`dial unix /var/run/usbmuxd: connection refused` in ios.log; not
  something I did) and took the syslog captures and the Web Inspector server with it. The phone itself stayed up; I
  restarted the capture (runs 6-9 are from the second capture). The app's log shows a connection start at
  12:08:33.96 ("starting Tailscale", "finding RemotePairing's port") with no outcome in either capture: the app was
  on Installation & Signing's "Checking… Pairing and the VPN" right after (screenshot `r53-16`), which then read
  Ready to Install; how my Install taps ended there is not known (the usbmuxd restart came between them). No
  install ran then: run 6's "before" still listed 3.0 from run 5. The unfiltered capture ran only for runs 3-4.
- `ev.mjs` (R58's) doesn't await promises; `awaitPromise` didn't help through pymobiledevice3's CDP server, so the
  bridge calls stored their results in a page global and a second call read them.

## Not verified

- **The user's own phone** (iOS 26, their network, a real 300+ MB app like RyukGram, Instagram's own audio/video
  session): not reachable from here; the 15 Pro runs iOS 27.0.1 on the same LAN as its Tailscale peer. Voice Memos
  and Camera stand in for an app that takes the audio session; whether some app's session does interrupt a mixable
  one (a phone call, Siri, an alarm would) was not tried: the 15 Pro has no SIM calls, plays no sound, and its
  Clock alarms aren't heard (memory: iPhone 15 no sounds). The Apple Account now on the 15 could install such an
  app from the App Store, but a purchase may ask for the owner's password; not tried.
- **DERP-relayed path for a whole install**: could not be forced from the phone; only run 2's accidental fallback
  to DERP was seen, and no data moved over it.
- **LocalDevVPN route**: not installed on the 15 Pro.
- **Why run 2's direct path broke**: not reproduced (1 in 7); the Tailscale extension's own log for that minute
  wasn't captured (the unfiltered capture started after it).
- **A drop during installd with a longer installd**: installd took 3-5 s for this test IPA; run 9 dropped right at
  its start, so the "quiet for 30 s" path ran, but not a drop in the middle of a long verification.

## Phone left as

iFizBox 0.18.4 (3695, this branch, rig-signed), paired, Tailscale signed in, Install Apps With This iPhone, VPN on
(checked by pixel). R53 Test uninstalled; its IPAs (Documents) and signed copies (MyIPAs) deleted; its Signed Apps
records left. Two Voice Memos recordings and a few Camera photos/videos stay on the phone. UI lock released.
