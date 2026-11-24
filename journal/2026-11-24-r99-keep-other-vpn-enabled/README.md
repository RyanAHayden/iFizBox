# R99: keep the other VPN enabled, or bring it back without a person

Research only, no code. Measured on the iPhone 15 Pro (iOS 27.0, Tailscale On Demand on) on 2026-11-24, with the
syslog recording and Settings > VPN never opened.

## Summary

| # | Idea | Result |
|---|------|--------|
| 1 | A Shortcut's **Set VPN** after our configuration is removed | **Works with no tap or prompt at run time** (runs started by URL from the rig, not by the app; the user adds the Shortcut once). It enabled Tailscale again and it connected, with no iOS prompt and no dialog in Shortcuts. |
| 2 | Open Settings > VPN for the user (`app.openURL`) | **Does not reach the page.** `App-prefs:VPN`, `App-prefs:General&path=VPN` and `App-prefs:root=General&path=VPN` only bring Settings forward on whatever page it was on (Apps here); `prefs:root=General&path=VPN` did nothing. Tailscale stayed off. |
| 3 | Tailscale's own **Connect** button | Works (it saves its configuration enabled, ours goes to enabled = 0), but a person taps it. |
| 4 | Private `grade` | Not run again; B427a found it reads 1 with no setter. |
| 5 | A Personal VPN (`NEVPNManager`) kind | Not run (see below). |

## What was measured

Reproduced first: with Restore My VPN on and Tailscale connected, `vpn.test` saved our configuration and
nesessionmanager logged `NESMVPNSession - enabled = 0 <Tailscale>` in the same 15 ms; the removal 3 s later left
Tailscale off ("Not Connected", "VPN On Demand Enabled, to reconnect you might need to adjust your VPN On Demand
rules", with a Connect button).

### 1. Set VPN restores it (the finding)

The Install Switch Shortcut (still on the phone from F386; the app stopped using it in C72) was run by URL
(`shortcuts://run-shortcut?name=Install%20Switch&input=text&text={"start":1}` then `{"end":1}`):

1. Tailscale on (its Connect button), our configuration present.
2. Start run: Get Current VPN stored Tailscale, Set VPN connected ours (`enabled = 1 <iFizBox VPN>`, Tailscale `enabled = 0`).
3. `vpn.test` with Restore My VPN on, Tailscale up as it began: our configuration removed (`configuration removed`), Tailscale off.
4. End run, **after the removal**: `enabled = 1 <Tailscale>` twice, then `idevice.status` said `otherVPN: true`, tunnel `utun5`.
   No prompt, no dialog; Shortcuts showed its plain list.

So iOS lets Set VPN enable a configuration that another save disabled, which our app cannot do itself.
What it needs (inferred, not measured): the VPN is stored **before our configuration is saved**. A start run on
its own when ours was already gone showed "No VPN was passed" from its Find VPNs step, and a lone end run with
nothing stored changed nothing; what Get Current VPN returns after the save was not run. Get Current VPN is generic,
but only Tailscale was tried.

Costs: Shortcuts comes to the front for each run (one trip per queue, as F394 did), the Shortcut has to be added
once by the user (the share-sheet Add), iOS 16+ only, and R77 saw NEVPNErrorDomain error 2 at the end of Set VPN
(not visible here: no dialog; the callback was not read).

### 2. Settings deep links

`app.openURL` with the three `App-prefs:` forms brought Settings forward, always on the Apps page it had been left
on; no link opened VPN. Nothing was enabled (last `enabled = 1 <Tailscale>` was the Shortcut's). So the
"open Settings > VPN for the user" idea can only say "open Settings and tap General > VPN & Device Management > VPN"
and needs the person anyway. Opening the page is what re-enables the VPN (B427a, 3 times); it cannot be reached by
link.

### 3. Tailscale's Connect

Tapped twice through the rig: `enabled = 1 <Tailscale>` and `enabled = 0 <iFizBox VPN>` at the same moment. It
does not need Settings. A person (or a UI test) taps it.

### 5. Personal VPN: why it was not run

`NEVPNManager` configures only IKEv1/IKEv2/IPsec protocols; our loopback is a packet tunnel provider
(`NETunnelProviderManager`), so the 10.7.0.1 route cannot be carried by it. NE's one-enabled-configuration rule
applies to every kind, as far as iOS's documentation says; not tested here.

## Recommendation (the product decision is the person's)

Bring the other VPN back with a Shortcut around the installs, as F394's Install Switch did: store the current VPN
before our configuration is saved, run Set VPN on it after Restore My VPN removed ours. The pieces exist
(`tools/shortcuts/install-switch.plist`, its end run) and the measured order works. The cost is the Shortcuts
trip and the one-time Add. Without it the honest text stays: the other VPN returns when Settings > VPN is opened
or the other VPN's own Connect is tapped (B427b's footer).

If a Shortcut is wanted: queue an F task `Restore My VPN: bring the other VPN back with a Shortcut` after the
person's OK. It is not filed here because it changes the product's Shortcuts stance (C72 removed them).

## Not verified

- `signing.openApp` on Settings, and any other deep-link form than the four tried.
- "iOS 16+ only" for Set VPN, and that NE's one-enabled rule covers a Personal VPN: from memory of Apple's docs, not checked.
- A VPN other than Tailscale as the other one.
- The x-callback result of the end run (error 2 or clean); only the NE log and `otherVPN` were read.
- Wording and timing of Shortcuts coming to the front in a real queue, and on a locked phone.
- That Get Current VPN stores a VPN when run after ours was saved (inferred, not run).
- Real cellular (no SIM), Personal VPN and `isEnabled = false` saves (not run: need a scratch build).
- The installed app on the phone logs "your VPN has its checkmark back", which this worktree's source does not
  (source says "Restore My VPN: configuration removed"); the phone build differs from the worktree, so removal timing
  seen here is the phone build's. One removal did not happen when no other VPN was up as the app began (it did at
  15:17 and 15:23 with Tailscale up).

## Phone put back

Restore My VPN off (as found), Tailscale connected, Shortcuts untouched, UI lock released.
