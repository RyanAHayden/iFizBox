# F386: Install Switch replaces the two Cellular Shortcuts

## Summary

One signed Shortcut, **Install Switch**, now does what the two Cellular Shortcuts did: before a queue of
installs it turns cellular data off and connects the built-in VPN (shown as iFizBox VPN), and after the queue
it turns cellular data back on and reconnects the VPN that was on before. The phone checks on the iPhone 15 Pro
(iOS 27) passed for adding, a test run, a start-only and end-only run, and a real install. Two problems came up
(a stuck Set Up row, and a harmless-looking VPN error at the end of the run); one is fixed in code but not
re-run on the phone, and the other is fixed in the app but the plist reorder that would avoid it was not re-signed.

## What was built

- `tools/shortcuts/install-switch.plist`: the Shortcut source. It takes JSON dictionary text:
  `{"start":1[,"cellular":1]}`, `{"end":1[,"cellular":1]}` or `{"check":1}`. Values are read with Get Dictionary
  from Input and Get Dictionary Value and tested only with "has any value" (condition 100). "Contains" (99) lost
  its text on import (B359), so it is not used.
  - Start: Get Current VPN, Store Content "previous VPN" (or Delete Stored Content when there is none),
    Cellular Data Off when cellular is asked for, then Find VPNs where Server Address is 10.7.0.1 (limit 1) and
    Set VPN Connect.
  - End: Cellular Data On when asked for, Get Stored Content, Set VPN Connect, Delete Stored Content.
- `tools/shortcuts/sign.sh` signs it to `web/app/shortcuts/Install Switch.shortcut`. The plist is converted to
  binary1 before signing.
- `native/sideload/vpn/App/LocalVPN.swift`:
  - The first `LocalVPN.begin` of a queue runs the start Shortcut (`switchedOn`).
  - `LocalVPN.end` runs after the 3 s linger: `down()`, then `endSwitch()`.
  - An end that comes due while the app is in the background waits for `didBecomeActive`.
  - A start that never reached Shortcuts clears `switchedOn`.
- Bridge: new call `vpn.testSwitch`. `vpn.testShortcuts` is removed (no caller; `test_bridge_contract` covers it).
- Old Cellular Shortcuts still run for phones that already added them (`shortcutsAdded`), but are no longer offered.
- Web: the Set Up row "Install Switch" is the Add itself (share sheet, then a check run). The installation and
  shortcuts pages are titled Install Switch, with a Test Install Switch button. Cellular warnings say to add the
  Install Switch.

## How the Shortcut's plist keys were found

R76 had not read the keys. The MBA was offline for most of the session, and the iPhone 7 (iOS 15) WorkflowKit
`WFActions.plist` has no VPN actions, since they exist only from iOS 27 (ToolKit v78).

Found through public GitHub code search:
- `viticci/shortcuts-playground-plugin` `ACTIONS.md` lists the `vpn.set` keys: `WFVPNOperation`
  (Connect, Disconnect, Toggle, Set On Demand, Toggle On Demand), `WFVPN`, `WFOnDemandValue`. `vpn.get` takes no
  keys. `filter.vpns` uses `WFContentItemFilter`.
- A real exported plist in `kuscholar/iDeck` (`tools/shortcuts/Madeira JIT.plist`, not kept here) showed
  Get Current VPN, then Store Content "previous VPN", then Get Stored Content, then Set VPN with `WFVPN` as an
  ActionOutput token. That is the route used so the VPN survives between the start run and the end run.
  R76's approach (converting text to a VPN) fails.

Only the facts and key names were used. No code was copied.

## Phone checks (iPhone 15 Pro, iOS 27)

Setup: Wi-Fi, no SIM, Tailscale selected and connected.

1. Add on Set Up opened the share sheet, then Shortcuts, then Add Shortcut. The editor showed every action as
   written (Receive Text and Dictionaries, Get Value for start, end and cellular, If has any value, Store and
   Delete previous VPN, Find VPNs where Server Address is 10.7.0.1, Get 1 VPN, Connect to VPNs). The check run
   passed and the row showed Done.
2. Test Connection: syslog showed "Install Switch: start ran", then the connection through iFizBox VPN, then the
   verify step passed, then the end ran with an error (see Problems). Settings > VPN afterwards: Tailscale checked
   and Connected. No iOS prompt.
3. Shortcut run by URL:
   - Start alone: Settings showed iFizBox VPN checked and Connected, no prompt.
   - End alone: Tailscale checked and Connected, but Shortcuts showed "The operation couldn't be completed.
     (NEVPNErrorDomain error 2.)" as an alert. Through x-callback-url (how the app runs it) no alert appears, and
     Shortcuts returns to the app with x-error.
4. Real install: re-sign of Probe from Installed through This iPhone. Syslog: start ran, install done in 2.1 s
   through iFizBox VPN, vpn off, "Install Switch: end ran". Settings > VPN afterwards: Tailscale checked and
   Connected. No iOS prompt.
   A second queued re-sign (B264 Test) failed at its download, before any install began. Its source is an old
   https test server that no longer exists. This is unrelated to F386, so the queue had one install.
5. Test Install Switch on its page: alert "Install Switch Works".

## Problems found and fixed

a. **Set Up row stuck on "Checking…"** after a passing Add. Returning from Shortcuts redraws the page with a new
   painter, and the finished Add repainted the old one (`paint()` stops when `!mine()`). Now the Add calls
   `redraw()` when it finishes. Rebuilt. This exact Add flow was not re-run on the phone, because the Shortcut was
   already added.
b. **Set VPN on the stored VPN switches back but reports NEVPNErrorDomain error 2** (configuration disabled). That
   ends the run before Delete Stored Content runs. `LocalVPN.switchEnded` now treats that error as done. The
   stored VPN left behind is overwritten or deleted by the next start. Reordering the plist (Delete before Set VPN)
   was written but reverted, because the MBA was offline again and the signed file has to match the source. The
   file on disk therefore still has the old order.
c. **Page footer still said "Tap Shortcuts, then Add Shortcut"** once the Shortcut was added. It now shows only
   the description.

## What failed / was tried

- Signing: the MBA came online once. `tools/shortcuts/sign.sh mba install-switch` signed it. It was offline again
  after that, so the reorder in (b) could not be signed.
- The "contains" condition (99) lost its text on import (B359). Replaced by "has any value" (100).
- R76's text-to-VPN conversion fails. Replaced by Store Content of Get Current VPN.
- The second queued re-sign (B264 Test) failed at download. Unrelated to this change.

## Not verified

- Anything on cellular: the 15 has no SIM, so Cellular Data Off and On inside the Shortcut, and `waitOffCellular`,
  were not exercised.
- A queue of two or more installs sharing one start and end. The second job in the test failed at download.
- The Add repaint fix (a) on the phone.
- The end run deferred while the app is in the background (`didBecomeActive` path).
- A VPN other than Tailscale as the previous VPN.
- The "Add VPN Configurations" prompt coming back. It was never reproduced, same as R76.
- A re-signed plist with Delete before Set VPN (b).
- Whether Find VPNs by Server Address works when another VPN also uses 10.7.0.1.
