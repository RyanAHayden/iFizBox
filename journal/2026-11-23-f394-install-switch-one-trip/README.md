# F394: Install Switch in one trip to Shortcuts per queue

## Summary

A queue of installs on This iPhone now opens Shortcuts once, not once per connect. The added Install Switch runs
one trip: it connects the built-in VPN from inside the Shortcut (Connect VPN), opens iFizBox (Open), waits behind
the app while the queue goes on (Wait for Install), and then turns cellular data and the user's VPN back on. The
app asks for the Install Switch only when a connect would need it. The phone checks on the iPhone 15 Pro (iOS 27.0.1)
passed for the trip, for real installs, and for the failure cases listed below. Replace in Shortcuts left a
duplicate on iOS 27, so the Update row now says to delete the old Install Switch first.

## What was built

- `tools/shortcuts/install-switch.plist` and `tools/shortcuts/sign.sh`: one Shortcut with a `trip` verb (input
  `{"trip":1}`, plus `"cellular":1` on cellular). The old verbs (`start`, `dataOff`, `end`, `on`, `off`, `check`)
  stay, so an Install Switch added before this build keeps working through its own runs.
- `native/sideload/vpn/App/LocalVPN.swift`:
  - `takeTrip` opens the trip and waits until Open ran (or the callback says it didn't open).
  - `tripConnect` (Connect VPN) runs `up()` inside Shortcuts' process; it refuses unless an install is running.
  - `tripOpened` (Open) lets the install go on; `tripWaiting` and `tripWaited` count the Wait for Install turns.
  - 45 turns of 20 s, because Shortcuts cuts one action off at about 30 s. The last turn puts everything back, so a
    queue longer than 15 minutes is put back at its 45th turn. A connect during that queue doesn't start a new trip;
    the end runs once the queue is over.
  - `endTrip` runs after the VPN goes off: it waits until the Shortcut has put things back (25 s after the queue, or
    10 s after the waits ran out), and leaves what it didn't put back to `endSwitch`, which runs `{"end":1}` as a retry.
    The trip's end keeps the remembered VPN; the next start replaces it.
  - `checkSwitch` runs the check with `{"check":1,"actions":1}`. A Wait for Install turn in it proves the one trip
    (`ifizbox.vpn.shortcut.trip`), and iOS asks its Allow there, at setup, not over an install.
  - `savePending` and `restorePending`: what a run took out is kept in UserDefaults (`ifizbox.vpn.switch.pending`)
    until it is back, so a killed app (self-update included) puts it back at the next launch.
  - `up()` re-reads the VPN configuration before it connects, since another VPN set afterwards disables ours without
    an error. Without a network it refuses before saving anything.
  - `begin()` starts no Install Switch run without a network.
- `web/app/core/installroute.js`: `switchWanted` (the prompt rule), `setupFooter`, `shortcutDidntRun` (for Replace's
  duplicate: "delete both, then tap Add"), and the `vpnStaysOff` alert.
- `web/app/screens/installroute.js`: the Update row, and the Install Switch page's footer "To open Shortcuts once per
  install, delete Install Switch in Shortcuts, then tap Update."
- `docs/sideload.md` (Built-in VPN) and `release-notes/F394.md`.

## Design choices

- One Shortcut with a trip verb, not a new Shortcut. Users keep the one they added, and the old verbs keep working
  for a Shortcut added before this build.
- The check run proves the trip: its `{"check":1,"actions":1}` reaches Wait for Install or the build doesn't use
  trips. An older Install Switch ignores `trip`, and the app then runs its own runs as before.
- The pending key in UserDefaults is the only memory across a kill. Nothing else survives a killed app.
- Connect VPN is refused outside an install (`busy`), so nothing turns the VPN on for no install. Wait for Install
  answers that the queue is over then, so the Shortcut stops waiting.
- Shortcuts' callback decides nothing once the app's own actions ran. On iOS 27 a new run can get the error of the
  previous run that ended behind the app (Set VPN's error 2), so the app goes by Connect VPN, Open and the Wait turns.

## Tried and failed on the iPhone 15 Pro (iOS 27.0.1)

- Replace in Shortcuts left duplicates of Install Switch (34 and 64 actions). Shortcuts then said "Could not find
  the shortcut" and neither ran by name. Deleting both and adding once worked. T75 saw the same. The Update row now
  says to delete first.
- A second trip failed with "didn't connect in 10 s". The cached configuration said enabled, after Set VPN had put
  Tailscale back, so the start never connected. `up()` now reads the configuration again.
- Stale x-callback errors from the previous run were read as this run's. The app now goes by its own actions.
- The first version ran the check twice per retry.
- A Connect VPN error without a network left Shortcuts in front. Enabling our configuration offline left Tailscale
  off. Both are fixed: no start without a network, and the configuration is left alone when there isn't one.

## Phone checks (iPhone 15 Pro, iOS 27.0.1)

Tailscale on, Wi-Fi. The phone is needed for Shortcuts, the VPN and installd.

- Old Install Switch with the new build: check ok, trip false, test passed.
- New Install Switch: the check asks for Allow, then trip true, test passed. The test came to the front in 1 s, and
  Tailscale was back 4 s after the VPN went off.
- Real installs of Probe through `signing.resign`: 3 in a row, one run each. Tailscale was back about 3 to 4 s after
  the VPN went off.
- Home pressed after Open: the VPN went back in the background, and Shortcuts didn't come to the front on return.
- Home pressed before Open ran: waited 25 s, then fell back, and the end run put the VPN back.
- Killed 2.6 s into a trip: the Shortcut ended with an error. The next launch ran the end, and Tailscale came back.
- Failed install (the IPA's MinimumOSVersion is 99, so installd answers DeviceOSVersionTooLow): the VPN went back,
  with one trip.
- Airplane Mode, before the last fix: refused at once, saying there is no network. The end run came after.

## Review findings

A spec review of the last code changes found three problems, all fixed:

- A trip's end that didn't put things back had no retry. Now `endSwitch` runs `{"end":1}` as one.
- Waits that ran out mid-install let a connect start a new trip. Now the Shortcut puts things back, a connect during
  the queue doesn't start one, and the end runs once the queue is over.
- The app ran its own Cellular Data Off after the trip had already turned data off. It is skipped when the trip's
  Connect VPN began and didn't fail.

Not fixed, and older than this change (from B381): a carrier ipsec tunnel with an IPv4 address (Wi-Fi Calling) counts
as another VPN in `LocalVPN.otherVPNUp`. An install could then show "Your VPN Stays Off", or open Shortcuts for it.
Filed as a low plan item. Not verified: no SIM on the phone.

## Final fix retest

On the iPhone 15 Pro (iOS 27.0.1), with the final build:

- The old Install Switch was deleted and the new one added once. Its check run gave trip true. The Allow prompt was
  not checked again by screenshot.
- Two real installs, one Shortcuts run each. Tailscale was back 4 to 5 s after the VPN went off.
- Airplane Mode: "not needed", and Shortcuts never opened. Tailscale came back by itself after Airplane Mode went
  off (before the fix it stayed off).
- A kill repeated on the final build went through Tailscale, not a trip: the built-in VPN had just failed, and within
  60 s of a failure a connect takes no trip. So the kill result under Phone checks is from the build before the last
  review fixes. The pending and launch path is unchanged.

## Not verified

- End retry after a failed trip end.
- A carrier ipsec tunnel (Wi-Fi Calling) counted as another VPN: see Review findings. No SIM here.
- Real cellular: no SIM on the phone here (data off and on, the 3 s wait).
- iOS 16 to 26, and iOS 15 (an unknown action in a branch no check reached).
- A renamed app, or a different team's signing.
- Don't Allow on the Shortcuts prompt.
- The 15 minute deadline run (the 45 Wait turns running out during an install).
- The screen locked during a trip.
- A self-update kill. A plain kill was tested.
- The web prompt wording on the phone: only the node tests ran.

## Phone state

- The Install Switch on the phone is the final build's, added once after the old one was deleted.
- Tailscale on, Airplane Mode off.
- "Tailscale Would Like to Send Notifications" was answered Don't Allow.
- The build on the phone is this branch's.
