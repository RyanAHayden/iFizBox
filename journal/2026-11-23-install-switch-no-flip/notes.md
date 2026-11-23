# R78: Install Switch without opening Shortcuts

Research task. **Nothing was measured.** The iPhone 15 Pro's UI lock was held by B381 for the whole session, and every
question below needs the phone plus a probe build and hand-built Shortcuts (Chromium runs no Shortcuts). This note
holds what the repo already shows, what each option needs, the measurement plan, and the expectations to test. Every
"expect" line is a hypothesis from reading the repo and general iOS knowledge, not a result. The measuring is queued
as R78a to R78d (end of this note).

## What the repo already settles

- The Install Switch today (`tools/shortcuts/install-switch.plist`, `LocalVPN.swift`): the app opens Shortcuts through
  `shortcuts://x-callback-url/run-shortcut`; Shortcuts is in front for the run and comes back through `x-success`.
  The start (remember VPN, Set VPN, Cellular Data Off only on the old path) and the end (Cellular Data On, Set VPN
  back) are two hops, plus a `dataOff` hop on cellular (B375). F388 limits it to cellular or another VPN being up.
- iOS starts no VPN without a network (B375, Airplane Mode repro). So the order is VPN up first, then data off. A VPN
  that is up survives data off (counter-check in B375).
- Set VPN works silently, switching between Tailscale and our VPN (R76), but often ends with NEVPNErrorDomain error 2
  while iOS enables our configuration; `LocalVPN.up()` connects regardless. A VPN cannot be named from text (R76), so a
  signed Shortcut cannot say "connect iFizBox VPN" by input; this is why an intent that calls `up()` is the right
  shared piece.
- App Intents exist (`native/intents/`, built on Linux without Xcode, metadata written by `metadata.py`). `metadata.py`
  refuses explicit `supportedModes`, entities and parameter defaults. The sideload IPA ships only the allowed list
  (`SIDELOAD_INTENTS` in `build.sh`; `mkipa.py check` refuses another set), so new intents mean touching that list and
  the metadata writer if they need anything beyond a plain `perform()` with `openAppWhenRun = false`.
  A LongRunningIntent or a background-continuation type would very likely need `metadata.py` support first.

## The shared piece (to measure first)

Two intents, `openAppWhenRun = false`, run in the app's process in the background:

1. **Connect VPN**: calls `LocalVPN.up()`, returns when the tunnel is up (or throws with the reason).
2. **Wait for Install**: returns when the install queue ends, fails, or a deadline passes.

Questions: does the intent run with the app not in front and the screen on or locked; does #2 outlive 30 s (expect no
guarantee: App Intents run under the extension-like time limit when the app is not in front; test 20, 30, 60, 120 s);
does a loop of short waits in the Shortcut work as a fallback (expect yes, at the cost of Shortcuts' run staying alive);
is there an iOS 27 API for long work (name it from the SDK once the MBA has it; unchecked here).
`LocalVPN.up()` in the background also needs `NetworkExtension` to be allowed with the app not in front: expect yes (it
runs from the app's process, same as now), unmeasured.

## Option A: Notification automation (iOS 27 trigger)

Idea: the app, in front, posts a local notification titled for example "iFizBox Install Switch start"; an automation
that runs without asking runs the switch in the background; Shortcuts never opens.

Tests, in order:

| # | Test | How | Expect (hypothesis) |
|---|------|-----|--------------------|
| A1 | Fires for a local notification from the app in front | `willPresent` returning banner, list, none in turn; automation filter on title | Unknown, and the main one: nothing here says whether a notification the app suppresses or posts while in front still triggers the automation |
| A2 | Latency | timestamps in the syslog from post to the first action | under 2 s if it fires |
| A3 | Shortcuts stays closed; banner or Dynamic Island shown | screenshots right after | no Shortcuts UI; a "Running" banner may show for run-without-asking |
| A4 | Runs Set VPN and Set Cellular Data with no prompt | the switch inside the automation | R76 showed Set VPN silent by hand; automations may ask for Cellular Data |
| A5 | Notification removed at once | `removeDeliveredNotifications` after the post | likely yes; the automation should have fired already |
| A6 | A Focus blocks it | Do Not Disturb on | expect yes for a Focus that silences the app, test it |
| A7 | A signed `.shortcut` can carry the trigger | read a Shortcut exported with an automation; try `WFWorkflowTypes`/trigger keys | Open. The brief says iOS 27 lists triggers among the actions, which would let a Shortcut carry it; before iOS 27, automations lived apart from the Shortcut file. Read an iOS 27 export first. If it cannot, the user makes the automation by hand. Count the taps when measured: Automation tab, +, Notification, choose app, filter, Run Immediately, choose Shortcut, Done is about 8 |

Failure handling: if iFizBox is killed after the start, the end never fires. The automation approach has no hook for
"app died". Mitigation: the end is also posted by the next app launch (the app remembers an open switch in its
state), so data and VPN come back at the next launch; until then data stays off. Weak.

## Option B: App Opened automation with a waiting Shortcut

Idea: an automation "When iFizBox is opened" runs a Shortcut that loops on the Wait-for-Install intent until an
install starts, does the start, waits for the end, does the end.

Tests: survives 2, 5, 15 minutes; battery and CPU cost from a `ios` syslog/`powerlog` sample; whether iOS shows the
run (the status bar or Dynamic Island), and whether a Shortcut run is killed on a lock. Expect: iOS kills a Shortcut
run after a few minutes in the background, and Shortcuts may show a running indicator. Without Run Immediately, iOS also
shows a notification each time the app opens. Failure handling: if the Shortcut dies, same as A: restore at next launch.

## Option C: a row in our own share sheet

Idea: our share sheet lists the Switch Shortcut as a row with a custom type, so only it accepts it; tapping it runs the
Shortcut over iFizBox. Likely this is the iOS "Run Shortcut" action-extension style handoff from a share sheet, which
ends in Shortcuts running with the app behind it: expect a brief Shortcuts presentation, not zero. Measure: does it
open Shortcuts' UI, does the result return to the app, and the tap count (expect one extra). Failure handling: the same
x-callback `x-error` path as today.

## Option D: fallback for iOS 16 to 26

Idea: one hop per queue. Shortcut: remember VPN, call Connect VPN, Cellular Data Off, call an intent that opens iFizBox
with `openAppWhenRun = true` and starts the install, Shortcut goes on in the background, then waits (Wait for Install
loop), data on, Set VPN back.

Key question: does a Shortcut run keep going once iFizBox is in front (the run started by x-callback from the app)? If
iOS ends it when the opened app takes the foreground, this option fails. Also whether an intent with
`openAppWhenRun = true` can hand the install start across without the app being told twice. Restore paths: install
fails (Wait for Install returns an error, the Shortcut's tail still runs because an If checks the result rather than
the action throwing), iFizBox killed (the intent in the Shortcut throws; Shortcuts stops at the error unless every
step after has been wrapped, which Shortcuts cannot do: there is no try/catch, so an error ends the run and data stays
off), wait times out (loop deadline then the tail runs). The no-try/catch limit is the biggest risk for D and for any
option that runs the restore in the same Shortcut.

## How each option handles failure (expected, unmeasured)

| Option | Install fails | iFizBox killed | Wait times out |
|--------|--------------|----------------|----------------|
| A | end notification still posted by the app | no end ever posts; restore at next launch | the app posts the end itself |
| B | loop sees the failure, runs the tail | the loop's intent errors, Shortcut ends, data may stay off | loop deadline, tail runs |
| C | as today | as today | as today |
| D | tail runs if tested by If | Shortcut errors, data may stay off | tail runs |

"Always restore" (the brief's rule) is not met by any option as described: when iFizBox is killed mid-install, A
restores only at the next launch, and B and D can leave data off because a Shortcut has no try/catch. Only a restore
that does not depend on the app or on one Shortcut run surviving would meet it (for example a second automation or a
scheduled restore); R78b/R78c must test that. Also: from F372 only the Settings checkmark behaviour (an On Demand
VPN does not reconnect by itself) was used, via F388. The stand-ins: Tailscale on stands for "another VPN up",
Airplane Mode for "data off", in every phone test above.

## Recommendation per iOS version (provisional, from reading only)

- **iOS 27**: try A first. If A1 shows the notification fires with the app in front, it is the only path with no
  Shortcuts UI and no loop; the user still makes the automation by hand (~8 taps, A7). If A1 fails, use B or keep today's
  two hops.
- **iOS 16 to 26**: keep the current Install Switch (F388's rule) until D's key question is measured. D is only worth
  building if the Shortcut survives iFizBox coming to the front.
- C does not remove the Shortcuts handoff in any version by this reading; low priority.

These are not measured results. Do not build on them before R78a to R78c report.

### R78d status (2026-11-23): no final recommendation yet

R78d was run to replace this section with a final one. It cannot be: R78a, R78b and R78c are all open and blocked
(the iPhone 15 Pro UI lock was held by T76; R78b waits on R78a's probe intents, R78c on F393's probe build). None of
`shared-piece.md`, `options-ab.md` or `options-cd.md` exists, so there is no measurement to base a pick on. The
provisional section above stays as the best current reading, and is still a hypothesis. R78d is reopened after R78a to
R78c merge; it then replaces the section with a per-version table (iOS 27, iOS 16 to 26) built only from their
results.

## Not verified

Everything: no probe build, no Shortcut, no phone test. The phone was locked by B381, and a measured answer also needs
a probe build with two new intents, which in turn may need `metadata.py` changes (not read in full). Every "expect" in
this note is a hypothesis. iOS 27's Notification trigger and its SDK APIs were not looked up.

## Follow-ups queued

R78a: probe build with the Connect VPN and Wait for Install intents, measure the shared piece. R78b: options A and B on
the phone. R78c: option D and C. R78d: the final recommendation per iOS version from those results.
