# B381: Shortcuts opens again after an install

## Summary

After an install on This iPhone, Shortcuts could open again when the user came back to iFizBox, with nothing to put
back. Found by reading the code; the first cause was reproduced on the iPhone 15 Pro (scenario B below), the second was not reproduced on
the phone. The end of the Install Switch now runs only once the queue is over, and only for what it has to put back
(cellular data it turned off, or another VPN that was up before the start). The automatic check on Installation &
Signing's pages is skipped while a connect would run the Install Switch. A tapped Check Connection still runs it.

## What was found

- (a) `LocalVPN.endSwitch` ran on every `didBecomeActive` when `switchedOn` was set and `holds == 0`, whatever it had
  to put back. Cases where that opened Shortcuts for nothing:
  - on cellular with no VPN before, when Cellular Data Off never ran;
  - when the user had already turned Tailscale or cellular data back on;
  - between two installs of a queue, inside the 3 s linger: the next install started the Install Switch again, and
    the end then ran when the app came back.
- (b) `screens/settings.js` redraws on `visibilitychange`. After a remembered route failure, the redraw's `autoCheck`
  (quiet) called `idevice.verify`, which runs the Install Switch when a connect would need it (on cellular, or with
  another VPN up). So each return to that page, at least 15 s apart, could open Shortcuts. (b) was found by reading,
  not reproduced on the phone.
- Looked at and not the cause: `backInApp` and `addShortcut`. They are armed only by a tapped Add.

## What changed

- `native/sideload/vpn/App/LocalVPN.swift`:
  - `switchEndDue` is set when the linger passes with no holds, and cleared by a new `begin`. `endSwitch` returns
    early unless it is set, so coming to the front between two installs ends nothing.
  - `switchDataOff` records that Cellular Data Off ran (or may have, when the error was not "didn't open"). `switchVPNBefore`
    records that another VPN was up before the start.
  - `switchEndNeeded(dataOff:vpnBefore:dataBack:vpnBack:)` is `(dataOff && !dataBack) || (vpnBefore && !vpnBack)`.
    `dataBack` is `Path.now().cellular`; `vpnBack` is `otherVPNUp()`. The end logs "end not needed" and skips Shortcuts
    when it is false.
  - The end's input carries `cellular` only when `dataOff` is set.
- `web/app/core/installroute.js`: `switchWouldRun(st)` is true when the built-in VPN is in use, the Install Switch is
  added, and the phone is on cellular or another VPN is up (`st.otherVPN`).
- `web/app/screens/installroute.js` `checkOnce`: when `quiet` and `switchWouldRun(st)`, it stops and returns without
  calling `idevice.verify`.
- Test: `web/app/screens/installroute-b381.test.js` (node). It evaluates the Swift rules' own expressions, so it checks
  the rules' logic, not the Swift build.
- Release note: `release-notes/B381.md`. Docs: `docs/sideload.md`, the Install Switch paragraph.

## Phone checks

iPhone 15 Pro, iOS 27, Wi-Fi, no SIM, Tailscale on, Install Switch added, build 0.25.0 (4701). Phone needed for the
native shell, the VPN, and Shortcuts. All with `vpn.test` unless said.

- A, in front: start, VPN off, end. The end ran with "VPN before true, now false", then Tailscale came back (utun4).
- B, Home during the install, return after about 10 s: "end waits until in front", then the end ran on return. This is
  the reported symptom, with a VPN to bring back.
- C, Home, Tailscale reconnected by running the Shortcut's end by URL, then return: "end not needed (... VPN before
  true, now true)", and Shortcuts did not open.
- D, two runs 1.5 s apart: one start, one end.
- Real install: `signing.resign` of Probe, Home about 2 s after installd's Complete, then return. VPN was off and the
  end ran on return. Tailscale's utun loses its IPv4 address while our VPN is up, so "now" reads right. In the real
  install the app was suspended before the 3 s timer fired (no log until return), so the built-in VPN stayed up until
  the return.

## What failed / was tried

- Two parallel native builds in the same worktree clashed. Rerun alone was fine.
- `signing.resign` of B375 Four and F359 A failed: their IPAs are gone from My IPAs.
- One terminal printout of D's end line looked like "now true". The raw syslog line says "now false".

## Remaining, by design

- With another VPN on before, leaving during an install means Shortcuts opens on return to bring it back. iOS opens
  Shortcuts only from the front. Asked the user (run ask).

## Not verified

- Cellular (no SIM on the phone): the `dataOff` and `dataBack` paths.
- Whether the user had a VPN on, and which phone.
- `autoCheck` on the phone (node test only).
- The old build's between-installs end (the race is read from code).
- A self-update that ends the process between start and end loses the state: `switchedOn` is in memory. Not looked into.
