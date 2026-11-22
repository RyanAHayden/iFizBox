# B320: pairing and Tailscale sign-in on the iPhone 15 Pro

The user's run through tools/remote-15.py (19:35): Sign In to Tailscale flashed an x and "failed" with "connection
invalidated", the app then had them Forget Pairing, pairing didn't start again by itself, the code shown didn't work
in Settings, and Developer Mode listed three "Pair with iFizBox" rows. A "Checking Pairing" HUD sat over Installation &
Signing meanwhile.

## What I found (on the 15, ui-15.sh + Web Inspector + `ios syslog`)

- At 19:41 Developer Mode showed three rows; avahi on the desktop saw one live advertisement. Going back and in again
  showed one. remotepairingdeviced makes a "pairablehost-N" per advertisement and drops it when the advert is lost
  ("Removing wireless pairing host ... because the wireless pairing advert was lost"); Preferences
  (AMFIDeveloperModeSettingVisibilityManager) processes its discovered/disappeared events late when it was in the
  background, and its rows don't follow: at 19:58:52 it logged discovered x2 then disappeared x2 and showed two rows,
  one dead. So every try that withdraws and re-advertises while Settings is open or backgrounded leaves a dead row,
  even with the same name and (after the fix below) the same TXT. A tap on a dead row can't reach the live listener:
  the code "didn't work".
- The Tailscale sign-in had in fact succeeded (node key from 19:34:40, `signedIn: true` when I looked). On the main
  page, Sign In redrew with `refresh` (auto check on): with a route failure kept, autoCheck ran idevice.verify while
  the sign-in started, failed (still signed out) and drew its x on the action row: the flash. That verify and the
  sign-in both sat on IDevice.queue.
- After the sign-in, recheckPairing's check of the kept pairing failed with a turned-down answer (the user saw
  "connection invalidated"); it only forgot refused pairings, so the user was sent to Pair Again by hand. Pair Again
  on the main page's Check Connection forgot the pairing and only redrew the main page: Start Pairing, no auto start.
  Forget on the Pairing page itself did restart pairing (checked on the phone).
- `idevice.pair` emitted the code at once but ran pairOnPhone on IDevice.queue: behind a verify, a tailscale.test or a
  10-minute tailscale.signIn the page showed a code with nothing listening.
- With everything clean, pairing with the shown code worked (19:44:41, typed with ui-15.sh type).

## What changed

- native: `idevice.pair` runs on its own queue (`pairQueue`); a second call while one runs joins it (same code, same
  advertisement; the earlier call answers "canceled: ..."); `idevice.pairCancel` ends the page's call at once and
  stops the advertisement 90 s later (`leaveGrace`) unless a page joins again, so leave-and-return doesn't churn
  advertisements.
- web: the main page's Sign In redraws without the automatic check and autoCheck never runs while signing in; the
  checks after the sign-in spin the status cell (Checking…, "Checking Connection…"/"Checking Pairing…") instead of
  the HUD; recheckPairing retries a pairing the phone answered and dropped (`turnedDown`: pair_again, early EOF,
  "invalidated") and then forgets it and opens Pairing, which pairs by itself; Pair Again from the main page's check
  opens Pairing; leaving Pairing drops the page's pairing state at once so coming back asks again (and rejoins);
  Install Apps With's own check of the kept pairing (picking This iPhone, a new Connect With) spins the Pairing row
  instead of the HUD.

## Spec review

Fixed: Install Apps With's "Checking Pairing" HUD (now the Pairing row spins; B322, filed before the review, is now
covered here), the join no longer depends on idevice.pairState's pin (the session keeps its code), a misleading
comment, and the journal line that said the main-page sign-in was checked in node tests only. Reverted: the kept
altIRK (an idevice patch 0003 and a Keychain item): it gave every try the same TXT but didn't stop the dead rows.
Kept, as part of the fix: the 90 s grace (the code notification and KeepAlive stay up those 90 s too), the automatic
re-pair after a retry (a dropped pairing right after a sign-in costs the code again, but the user had to find Forget
Pairing by hand before), the Pairing Advertisement glossary term. Still partial by nature: after more than 90 s away,
or after Forget Pairing or a relaunch, a new advertisement can still leave a dead row while Preferences stays open;
re-entering Developer Mode clears it.

## Checked

- node --test screens/installroute*.test.js core/installroute.test.js (113 pass, new installroute-b320.test.js).
- native/sideload/idevice/test_idevice.py (new OnePairingAtATime).
- On the 15 with build 4102 (first version of the fix): pairing starts within a second of opening Pairing (code
  687419, advertised 0.7 s later); a web view reload while pairing joined it ("joined the pairing that runs", same
  code on the page); leave and return re-advertised (with the kept altIRK, since reverted: same authTag). Settings
  still showed two rows after that leave-and-return, which is why the 90 s grace was added.
- On the 15 with the grace build: Pairing opened (code 216142, port 60313), Settings, back, leave and return: the
  page asked again and got the same code and port ("joined"), Settings showed one row, and typing 216142 paired
  (20:03:27, "Successfully wirelessly paired"); Pairing then showed Paired.
- On the 15, main page Sign In to Tailscale with idevice.status/tailscale.status faked signed out (Web Inspector
  hook, as R48) and a Tailscale Is Signed Out failure kept: no HUD, no x on the action row, no idevice.verify before
  the sign-in answered; the status cell went "Checking Connection…" (spinner), tailscale.test ok, "Checking
  Pairing…" (spinner), idevice.verify ok, then Ready to Install / Paired (screens b320-y*.png in ref/15/screens).
  The sign-in itself ran the real node (already signed in, so no login page).

## Tried that didn't work

- Same identity and TXT alone (kept altIRK) don't stop Preferences' dead rows: it keys them per advertisement.

## Not verified

- The Tailscale login page itself (a real login): the node is signed in and a new login needs the owner. The main
  page's sign-in flow was checked on the 15 with a faked signed-out status (above), so the login page never opened.
- The final build (kept altIRK reverted, Install Apps With's Pairing row spinner, the join keyed on the session) was
  not put on the phone again: those changes are a revert to main's IDevice.swift, a JS spinner checked by node
  tests, and a one-line Swift change the gate's native build compiles.
- The exact error text the user saw ("connection invalidated"): its log was before my syslog capture started, so
  `turnedDown` matches it by the word "invalidat" plus pair_again/early EOF; if the shell words it otherwise, the
  pairing is kept and the main page says Pair Again, as before.
