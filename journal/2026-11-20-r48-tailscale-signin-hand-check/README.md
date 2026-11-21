# R48: hand check of the Tailscale sign-in on the iPhone 15 Pro

## First attempt (2026-11-20)

The iPhone 15 UI lock was held by another task (B753), and the check was handed to the owner as a CONFIRM. The
user turned that down on 2026-11-21: run it on the 15 Pro, block only for a step that needs their password.

## What I did (2026-11-21)

The 15 Pro's Lite app already holds a signed-in Tailscale node (`ifizbox-on-iphone-4.beetal-ling.ts.net`,
100.109.186.91, key expiry 2027-05-20), paired, Connect With on Automatic. A real Sign In only shows after Sign
Out, and Sign Out deletes the node's state (container and Keychain), so the next sign-in needs the owner's
Tailscale login and every Tailscale install test on the phone waits until they type it.

**Stand-in instead of a new login.** Through Web Inspector (`pymobiledevice3 webinspector cdp`, docs as in the
phone web view debug notes) I wrapped `ifizboxNative.call` on the live page:

- `tailscale.status` answered `signedIn: false` until Sign In was tapped, so Settings > Installation & Signing >
  Install Apps With drew the Tailscale group's **Sign In** row;
- every `tailscale.*` call was logged with start and end times, and a MutationObserver logged each `.alert`.

This page is the brief's path: on Installation & Signing the row reads "Install Apps With: This iPhone ·
Paired", and tapping it opens the page that holds the Tailscale group (Sign In, then Device / Test Connection /
Sign Out). Then I tapped Sign In on the phone with `tools/ui-15.sh` (under its lock). The real `tailscale.signIn` ran (the
node started from its kept state, so no login page), then the page's own `connectAfterSignIn` and real
`tailscale.test` calls. Afterwards I put `call` back, stopped the inspector and released the lock.

## Results

| Run | What happened | Alerts |
|---|---|---|
| Success | signIn 0.29 s; first `tailscale.test` started straight after and passed in 1.44 s (`ok`, peer `iphone-15-pro-1`, 9 ms); then the Checking Pairing HUD (`idevice.verify`) | none |
| Final failure (first test faked as `needs_approval`) | signIn 1.46 s; the test loop stopped at once | exactly one: "Approve This Device" |
| Failure that clears up (first test faked as `no_answer`) | signIn 0.29 s; tried again 2.5 s later (the gap); second test passed in 1.5 s | none |

Screenshots, at a third of their size in `shots/` (all of them in the main checkout's `ref/15/screens/`,
gitignored): `r48-2` the Sign In row; `r48-s1` to `r48-s6`, taken every 0.5 s after the tap (`s1` and `s6` kept): Test
Connection says "Testing…" with the spinner by itself, then the Checking Pairing HUD; `r48-4` the connected state (Device, Test Connection with no value, Sign Out, footer "This iPhone
is 100.109.186.91 on your tailnet."; the LocalDevVPN rows are gone because the route is now Tailscale);
`r48-7` the single needs_approval alert.

- What the page does once `tailscale.signIn` returns matches B219: the Test Connection row spins by itself, the
  page lands connected, and no "Signed In" alert shows. A final failure shows one alert. A failure that can
  pass by itself is tried again with no alert. This covers the page's half only: the sign-in returned from a
  kept node, not from the owner coming back from login.tailscale.com (see Not verified).
- Timing, kept node only: the first `tailscale.test` passes on the first try, about 1.5 s after signIn returns.
  This says nothing about the 30 s budget for a node that has just logged in. The 2.5 s gap between tries
  worked as written.

## Second attempt: the real login (2026-11-21, 12:42–13:05)

The owner said they were at the 15 Pro. A teammate session passed on that they saw Tailscale already signed in
and no login page. That was the kept node; a real login only shows after Sign Out.

- The UI lock was held by R53, then R45. Polling every 20 s lost it to R45, so I polled every 2 s and got it
  at 12:42.
- Hooked the page (`hook.js`, `__fakeOut = false`), opened Install Apps With, tapped **Sign Out**, then
  confirmed. `tailscale.signOut` took 1.46 s and the group turned into one Sign In row (`shots/r48-r5`).
- Tapped **Sign In**: the row read "Signing In… Starting…" with the spinner, and about a second later
  login.tailscale.com opened in a sheet (`shots/r48-r7`).
- Nobody logged in. At 12:53 `tailscale.signIn` failed with "the sign-in didn't finish in 10 minutes" and the
  page showed one "Couldn't Sign In" alert (`shots/r48-r8`). I tapped OK and Sign In again at 12:55: the login
  page opened again, and that one also timed out at 13:05 with no login.
- Then I put `call` back, stopped the inspector and released the lock.

**State the 15 Pro is left in:** iFizBox is **signed out of Tailscale** (Connect With still says Tailscale; the
group shows Sign In). Every Tailscale install test on the 15 waits until the owner signs in once more. LocalDevVPN
and the pairing are untouched (Pairing: Paired).

What this run did check, on the real code with no stand-in:
- Sign Out from Install Apps With: confirm alert, "Signing Out" HUD, then the Sign In row.
- Sign In from a signed-out node opens login.tailscale.com by itself, about a second after the tap.
- A sign-in nobody finishes ends after 10 minutes with exactly one alert, and Sign In works again straight after.

What went wrong on my side:
- While the login sheet is in front, Web Inspector evals on the iFizBox page time out (the app's web view seems
  paused behind the sheet). They answered again once the sheet closed. So a watcher that reads `__log` can only
  read it after the sheet goes away: fine for timing, since the hook stamps times when each call starts and ends.
- My first watcher matched the first attempt's timeout text in the log. I saved that log, cleared `__log`
  (`clear.js`-style eval) and watched for a new `tailscale.test` or signIn end instead.

## For the reopened run (the real login)

1. `tools/ui-15.sh lock R48`, then `wake`, `launch`. Start `pymobiledevice3 webinspector cdp --port 9341` from
   `~/.local/share/ifizbox-rig/` in the background and keep its pid.
2. `node ev.mjs hook.js` (both in this folder). Then set `window.__fakeOut = false` in a second eval: the real
   status must show this time. `ev.mjs` evaluates a file's JS on the iFizBox page.
3. Open the page with `location.hash = "#/home/settings/installation/with"`, scroll down. The phone is already
   signed out (second attempt), so just tap Sign In (row at about 300,1990 after one swipe up):
   login.tailscale.com opens in a sheet. Tell the owner right away; they have 10 minutes before it times out.
4. Read `({log: window.__log, alerts: window.__alerts})`. The time from signIn's end to the first `ok`
   `tailscale.test` is the number the brief wants. Shoot the page while it spins.
5. If the tailnet asks for device approval, that's the real failure case: one alert expected.

## Side observations (no task filed)

- The needs_approval alert says `Approve "iFizBox"`, but the machine in the tailnet is named
  `ifizbox-on-iphone-4…` (the Device row). This is the wording `core/installroute.js` already uses. Left as is: a
  person can find it under Machines either way, and it's outside this check.

- The 10-minute timeout alert reads "Couldn't Sign In / the sign-in didn't finish in 10 minutes": the message
  starts lower case, unlike the app's other alerts. The text comes from `native/sideload/tailscale/Tailscale.swift`.
  Filed as a low-priority bug.

## Not verified

- **Still not verified after the second attempt (2026-11-21):** the owner didn't log in during either 10-minute
  window, so everything below about a brand-new node is still open. The login page itself now has been seen.
- **The login page itself and a brand-new node** (first attempt). I didn't sign out, so login.tailscale.com never opened and
  the node wasn't new in the tailnet. Timing for a new node's first `tailscale.test` (its map not yet holding
  the phone's Tailscale peer) wasn't measured, so the 30 s / 2.5 s guesses stay untested for that case. Signing
  out now, with nobody there to type the login, would leave the phone's Tailscale route broken for every other
  task until the owner came. So R48 blocks for that one step (spec review, 2026-11-21: the brief says to block
  for the login, not to skip it): the owner says when they're at the 15 Pro, and the reopened R48 then signs
  out, taps Sign In, and leaves the login page open on the phone for them to type in (`tailscale.signIn` waits
  up to 10 minutes). With the same Web Inspector hook it logs the time to the first passing `tailscale.test`
  on the new node, and whether an alert shows.
- **A real (not faked) needs_approval or no_answer.** The failure runs faked one `tailscale.test` answer in the
  page. The alert text and the retry logic are the page's real code, but the tailnet never actually refused.
- **The Settings main page (HUD) variant** (`hud: true`, Sign In from the Installation & Signing summary): not
  run. That page shows Sign In only when not signed in, and only the Install Apps With page got the stand-in.
