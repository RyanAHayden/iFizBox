# R78a: Install Switch without opening Shortcuts, comparison

## What was measured and how

A throwaway probe build on the iPhone 15 Pro, iOS 27.1, on Wi-Fi, measured the shared piece and four
options. The phone has no cellular service (its status bar says SOS), so every cellular result below is
unverified. Tailscale on stood in for "another VPN up". Airplane Mode for "no network" was not tried. The
probe used 20 hand-built Shortcuts and, for the notification test, one automation. Option B was not measured.

## Table

| Option | Shortcuts opens (times) | Extra taps per install | Set-up taps | Seconds added | iOS versions | Restored after failure / kill / timeout | Measured or not |
|---|---|---|---|---|---|---|---|
| Today's Install Switch (two or three hops by x-callback) | 2 or 3 per queue | 0 | 2 to add the Install Switch (Add Shortcut sheet) | About 1 s per Shortcuts open (measured for one hop, option C) | 16 to 27 in the repo; only 27 known | From the repo: the app runs the end hop by x-callback. Not measured here | Not measured now (from the repo) |
| D: one trip | 1 | 0 | 2 to add the Install Switch, plus 1 Allow at its first run | Connect VPN 0.2 to 0.3 s. Restore about 2 s after the loop ends. The loop adds up to 10 s unless the wait returns at once (not measured) | 27 measured; 16 to 26 not run | Failure: no, inside the Shortcut. The app must restore (end hop). Kill: no, restored at next launch. Timeout: yes | Measured on 27 |
| A: Notification automation | 0 | 0 | 13 taps, 2 swipes, 2 typed words for the automation; 2 taps to add the Install Switch; 1 Allow at its first run; iFizBox notifications on | About 2 s from the notification to the first action, plus the Connect VPN time | 27 only | Failure: not measured (the body is a Shortcut, so an error loses the tail as in D). Kill: no end is posted; restored at next launch (not measured). Timeout: not measured | Partly: firing, latency and a full switch run measured. Failure, kill and timeout not measured |
| C: share sheet row | 2 or 3 per queue (one per hop, as today) | 1 (opening the share sheet, against a button) | None beyond adding the Install Switch (2) | About 1 s per Shortcuts open | 27 | As today (the x-success and x-error callbacks return to the app). Not tested on its own | Measured on 27 for the tap and the return |
| B: App Opened automation | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured. Not needed, since A worked |

## Shared piece

Connect VPN and the wait run in the app's process with the app in the background. Connect VPN returns in
0.17 s when no VPN is up, 0.24 to 0.29 s with Tailscale up (iOS stops Tailscale, and the built-in VPN
connects), and 0.00 s when the built-in VPN is already up.

Each Shortcut asks once, at its first run: "Allow X to run actions from iFizBox?". If the Shortcut's last
action produces output, it also asks "Allow X to output N text items?", and that prompt blocks the screen
over iFizBox. So the real Shortcut must end with an action that outputs nothing.

Waits have a limit. A 30 s wait completes. A 60 s or 120 s wait is cancelled by Shortcuts at about 30 s, with
the error "timeout: The action could not run because an unknown error occurred". The app's own thread keeps
running after the cancel. So one wait must stay under 30 s. A loop of 12 waits of 10 s ran the full 120 s,
with Shortcuts in front and again with iFizBox in front. Screen locked was not tested.

## D one trip

One x-callback from the app starts a Shortcut. The Shortcut does this in order: Get current VPN, Connect
VPN, Set Cellular Data off, Open iFizBox, a loop of 12 Wait 10 s, Set Cellular Data on, a marker action, and
Set VPN back to the remembered VPN.

Shortcuts comes to the front once. The Open action brings iFizBox in front about 0.3 s later. The Shortcut
keeps going with iFizBox in front. The Dynamic Island shows it running.

- Happy path (Tailscale up first): Tailscale stopped when Connect VPN ran. The loop ran 2 minutes. The marker
  and Tailscale came back about 2 s after the loop ended, so the VPN was restored.
- Install fails (modelled by the last wait throwing): the Shortcut ends with an error. No alert shows while
  iFizBox is in front. The tail does not run: no marker, Tailscale not restored, the built-in VPN stays on,
  and cellular data would stay off.
- iFizBox killed mid-wait: the Shortcut ends with "XPC connection has been interrupted". The app is not
  relaunched and the tail does not run.
- Wait times out: the bounded loop is the deadline. When it ends the tail runs, so a timeout is restored.

A Shortcut has no try/catch and no break out of Repeat. So a failure or a kill cannot be restored inside the
Shortcut. The app must restore itself: after a failure it runs the end hop by x-callback, and after a kill it
does so at the next launch.

## A Notification automation

In this Shortcuts app an automation is a Shortcut whose first action is a trigger. The action picker lists the
triggers under Automation. "Notification: When I receive a notification from [App]" has Add Filter. The
Automation list shows it as "Run Shortcut" with a switch.

- A local notification posted by iFizBox while iFizBox is in front fires the automation. This was yes for all
  three presentation settings: banner, list, and none (suppressed).
- Latency: the first action ran about 2 s after the notification arrived, in three runs. The probe set a 3 s
  trigger delay.
- Shortcuts never opened. There was no Shortcuts UI.
- The automation ran the full switch Shortcut (Connect VPN, Set Cellular Data off and on, Set VPN). It asked
  only the one-time "Allow X to run actions from iFizBox?" at its first run. The cellular effect is
  unverified.
- Precondition: iFizBox notifications must be on (Settings > iFizBox > Notifications). With them off, the
  probe's permission request returned false with no system prompt, and nothing was posted.
- Set-up by hand, in order: Library > Automation (1), + (2), Edit (3), the Automation chip (4), scroll the list
  twice, Notification (5), App (6), the search field (7), type the app name and pick iFizBox (8), the actions
  search field (9), type "Run Shortcut" and pick it (10), its Shortcut parameter (11), pick the Shortcut (12),
  Back (13). That is 13 taps, 2 swipes and 2 typed words. An Add Filter on the title adds taps (not measured).
- Whether a signed .shortcut can carry the trigger is not determined. The trigger is the first action in the
  editor, but no export was read and the plist action key is unknown.
- Failure: the switch body is a Shortcut run, so an error inside it loses the tail, as in D. If the start and
  the end are two notifications, the app can post the end on failure and on timeout. That was not measured.
- Kill: no end is posted. The restore happens at the next launch (not measured).

## C share sheet row

The share sheet is our own UIActivityViewController with a custom UIActivity. It shows an "Install Switch" row
in the action row. One tap on the row opens Shortcuts by x-callback. Shortcuts is in front for about 1 s, and
iFizBox comes back by itself. The x-success or x-error callback arrived 1 s after the tap.

So Shortcuts still opens once per hop, as it does today. The cost is one extra tap: opening the share sheet,
compared with a button.

## B

Not measured. A worked, so B was not needed.

## Recommendation

**iOS 27:** build A, the Notification automation. It is the only option where Shortcuts never opens, and it needs
no extra tap per install. Conditions: the user allows iFizBox notifications, and makes the automation once (13
taps, offered as a guided set-up). The app restores what a failed or killed run leaves at the next launch, by
running today's end hop, because the tail in the Shortcut is lost on any error. Keep D as the fallback when the
automation is not set up.

**iOS 16 to 26:** build D, the one-trip Shortcut. It opens Shortcuts once instead of two or three, and the user
does nothing else. Keep the existing end hop as the failure path. When the app sees the install fail, it runs the
end hop by x-callback, so Shortcuts opens once. After a kill, it does so at the next launch.

C does not remove the Shortcuts open in any version, so do not build it. B was not needed.

## Not verified

- Cellular data: the phone has no cellular service (SOS), so every cellular effect is unverified.
- Airplane Mode as "no network": not tried.
- Screen locked: not tested for the intents, the Shortcuts or the automation.
- iOS 16 to 26: nothing was run there. The 30 s wait limit was measured on iOS 27 only. The iOS 16 starting point
  comes from the Shortcuts x-callback and App Intents support, not from a run.
- A, failure and timeout: not measured. A, kill: not measured.
- A, the trigger in a signed .shortcut: not determined.
- A, Focus (Do Not Disturb) blocking: not tested.
- A, a notification removed at once, a filter by title, and one automation for both messages: not tested.
- B: not measured.
- C, restore on failure or kill: not tested on its own. It follows today's path.
- D, the loop granularity with a real wait intent that returns at once when the queue ends: not measured.
- Other VPNs: Tailscale stood in for "another VPN up". No other VPN was tried.
- Wi-Fi only: no cellular path was used.

## Probe

How it was done, for the next person:

- A throwaway build from a scratch worktree. It was never merged. Its intents are App Intents: Probe Connect VPN
  (calls the built-in VPN's up, openAppWhenRun false), Probe Wait (N seconds in 1 s steps, with an optional throw
  at the end), Probe Open (openAppWhenRun true), and Probe Notify (openAppWhenRun true; posts a local
  notification 3 s later; willPresent returns banner, list or none).
- An in-app hook, ifizbox://r78a-run?name=X, opens shortcuts://x-callback-url/run-shortcut, as the Install Switch
  does. ifizbox://r78a-share shows a share sheet with our own row (a custom UIActivity type).
- 20 Shortcuts were written as plists, signed on the MBA (shortcuts sign), and imported through the Add Shortcut
  sheet (share sheet > Shortcuts > Add Shortcut, 2 taps each).
- Logs were read from `ios syslog`.
- Put back after the run: all 20 probe Shortcuts and the probe automation were deleted. The plain iFizBox build
  (native/build/iFizBox.ipa, built at 11:15) was reinstalled over the probe. iFizBox notifications were set back to
  Off. Tailscale was left connected, as it was at the start. The phone was locked and the lock released.
- Not restorable: the notification permission, and the app build that was on the phone before the probe, since
  the earlier build is replaced.
