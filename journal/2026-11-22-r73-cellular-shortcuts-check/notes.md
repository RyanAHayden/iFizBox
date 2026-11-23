# R73: F372's Cellular Shortcuts on the user's phone

Read first: journal/2026-11-22-f372-builtin-vpn/notes.md (built-in VPN, Cellular Shortcuts, its Not verified list).

## What was done

- Checked what I can reach: the iPhone 15 Pro (the test phone) has no SIM, so it can never be on cellular; the
  user's phone (iphone192 on the tailnet) is the only one with a SIM, and nothing here drives it (no WDA, no USB, and
  [[test-on-15-not-user]] keeps automated checks off it). So this check needs the user's hands: the steps below,
  blocked with CONFIRM.
- Took the wording each step should show from the code on main (web/app/core/installroute.js: CELLULAR,
  shortcutsTestResult, vpnTestResult, routeRefused; screens/home.js cellularTile), so the user can compare what
  they see against what is expected and say where it differs.

## Steps for the user (CONFIRM)

Before: iFizBox Lite with F372 (Settings > Installation & Signing lists **This iPhone** and **Signing Server** with
USE / ACTIVE). The signing profile must have Network Extensions (iFizBox's own App IDs have it).

**A. Without the Shortcuts** (none named Cellular Data Off / On in Shortcuts yet)
1. Installation & Signing > This iPhone > Set Up: pair if asked, then Test Connection on Wi-Fi. Expected: iOS asks
   to add VPN configurations once, then "Connected ... in N ms". Back on the main page, This iPhone shows ACTIVE.
2. Control Center: Wi-Fi off, cellular data on.
3. Home: the status slot says **Add the Cellular Shortcuts** ("On cellular, installs need them."); tapping it opens
   the Cellular Shortcuts page.
4. Installation & Signing: the status cell says the same, with the button to the Shortcuts.
5. My IPAs > an IPA > Install: an alert **Add the Cellular Shortcuts** with **Use Server / Try Anyway / Set Up**.
   Try each: Use Server installs through ifizbox.com; Try Anyway should end in "iPhone Refused" (every connection
   refused, add the Shortcuts or join Wi-Fi); Set Up opens the Cellular Shortcuts page.

**B. With the Shortcuts**
6. In Shortcuts make two, each one action **Set Cellular Data**: "Cellular Data Off" (Off) and "Cellular Data On"
   (On), names exact. On the Cellular Shortcuts page tap Add on both (they show Added).
7. Still on cellular, Wi-Fi off: **Test Shortcuts**. Expected: Shortcuts opens, data goes off (the signal letters
   go), back on, and Shortcuts returns to iFizBox by itself; alert **Shortcuts Work**: "Cellular Data went off and
   came back on." (Other wordings: "cellular stayed in use" = the first Shortcut doesn't set Off; "Shortcut Didn't
   Run" = a name is wrong.)
8. This iPhone > **Check Connection**: expected Connected; data goes off for the connect and comes back on.
9. My IPAs > an IPA > Install: no alert; data off for a moment, install log says "Connected to iOS through iFizBox
   VPN", ends "iOS installed ...", cellular data back on after, and Tailscale (if used) reconnects within minutes.

Send back, per step: what iFizBox said (alert titles and text, status cell, Home slot), and anything that hung or
needed a manual tap (most likely: Shortcuts not returning to iFizBox, data left off).

## What iFizBox said at each step

Not run yet: waits on the user (CONFIRM). Fill in from their answer when R73 reopens.

## Tried and failed

none

## Not verified

- **Every step above**: needs a phone on cellular with a SIM; the 15 Pro has none and the user's phone isn't driven
  from here. Blocked with CONFIRM for the user to run them.
- Whether the user's installed build already carries F372 (the Lite IPA on their phone): not checked from here; the
  "Before" line asks them to look for This iPhone / Signing Server with USE.
