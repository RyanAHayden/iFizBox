# R76: Shortcuts' Set VPN on the iPhone 15 Pro

Research only, no code. Measured on the iPhone 15 Pro (iOS 27) on 2026-11-23, with Tailscale and the
**Built-in VPN** (iFizBox VPN) both present in Settings > VPN.

## Summary

| # | Question | Answer |
|---|----------|--------|
| 1 | Can a Shortcut connect a named VPN with no iOS prompt? | Yes. Set VPN set to iFizBox VPN ran silently and connected it. The app's own connect path then ran fine. |
| 2 | Can a Shortcut switch back to Tailscale afterwards? | Yes, same action, no prompt. Tailscale shows Connected. |
| 3 | Can the VPN be chosen by name from text (Shortcut Input)? | No, not in the forms tried. Plain text fails with a conversion error; a Find VPNs lookup by Name also did not pass a VPN on. |
| 4 | Can ONE Shortcut do the whole set (text start/end input, If: Cellular Data Off + connect iFizBox VPN / Cellular Data On + reconnect the previous VPN)? | Not built; the Cellular Data steps were not tested here. The pieces exist, but the text-to-VPN step and the unread plist keys block a signed version. |

## Detail

### 1. Set VPN connects iFizBox VPN

- The Shortcuts action **Set VPN** (Settings gear icon; the VPN family also has **Get Current VPN** and
  **Find VPNs**, all with the blue VPN globe icon) is set to Connect to iFizBox VPN while Tailscale was the
  selected, connected VPN.
- The run showed no prompt of any kind. iFizBox VPN got the checkmark and Settings showed Connected.
- The app's own **Check Connection** (Installation & Signing; the app's `vpn.test`) then ran fine. Syslog:
  `vpn: on in 0.16 s`, RSD up at 0.20 s, verify done at 0.4 s, `vpn: off`. Tailscale logged `disconnected`.
  Check Connection showed Successful.
- Not tested: a real `signing.resign` install of Probe. Only `vpn.test` ran, which uses the same connect path.

Baseline (the problem, confirmed): after any app-run `vpn.test`, Settings > VPN shows iFizBox VPN selected
(checkmark), Not Connected, and Tailscale off. This was seen after Check Connection only; a real install was
not run, but it uses the same connect path. Order of events: the Shortcut connected iFizBox VPN (Settings showed
Connected); Tailscale's `disconnected` log lines were captured in the later Check Connection run.

The "Add VPN Configurations" prompt did not appear on this phone in two tries: once with Tailscale re-selected
by the Shortcut, once with Tailscale re-selected by hand in Settings, then Check Connection. The re-prompt
could not be reproduced here. The configuration is already saved and allowed. `LocalVPN.manager()` still calls
`saveToPreferences` each time (`isEnabled = true`).

### 2. Set VPN connects Tailscale afterwards

- A second Set VPN set to Connect to Tailscale ran with no prompt. Tailscale got the checkmark and the VPN
  status showed Connected.
- Settings then shows the footer "Tailscale will connect on demand." That is the normal text for Tailscale's
  on-demand configuration. It may be the "On Demand message" the task names; the task's wording does not say
  where it appeared, so this is unconfirmed. The VPN status-bar pill shows the connection, and no alert
  appeared.
- The action's output is a VPN object card (icon, name, app).

### 3. Choosing the VPN

- The parameter offers a VPN list (Tailscale, iFizBox VPN), Variables..., Ask Each Time, Shortcut Input, and
  Clear. So a VPN can be picked in the editor, asked each time, or taken from a variable.
- Shortcut Input given as plain text fails. Running
  `shortcuts://run-shortcut?name=Set%20VPN&input=text&text=iFizBox%20VPN` gave
  "Conversion Error: Set VPN failed because Shortcuts couldn't convert from Text to VPN".
- Find VPNs offers the filters Is Connected, Is Disconnected, Is On Demand Enabled, Is On Demand Disabled,
  Server Address, and Name (operator "is"; the value field accepts a variable such as Shortcut Input).
  Built: Receive input, then Find VPNs where Name is Shortcut Input, then Set VPN (Connect to the Find result's
  variable "VPNs"). With the text "iFizBox VPN", then "iFizBox", then "Tailscale", every run ended
  "No VPN was passed to the action. Please provide a VPN to the Set VPN action." The run with iFizBox or
  Tailscale may have shown a stale dialog; unclear.
- So a name-to-VPN lookup by text did not work in the form tried. Still open: whether Name matches the title
  ("iFizBox VPN") or the app name, whether another operator (contains) is needed, and whether a Shortcut Input
  in a filter value takes the text at all.
- Get Current VPN exists (it could capture the previous VPN) but was not run.

### 4. One Shortcut for the whole set

Not built. The pieces exist: Set VPN, Get Current VPN, Find VPNs, the Cellular Data actions, and If. Switching
needs no prompt. What blocks a signed one-Shortcut version is the text-to-VPN conversion and the unknown plist
keys. A VPN picked in the editor works only in a hand-built Shortcut. An imported one would have to carry a VPN
reference that exists only on that phone; `WFWorkflowImportQuestions` was not tried.

What the Mac showed about the action (not the phone): the legacy identifier is `is.workflow.actions.vpn.set`, class
`WFSetVPNAction`, picker `WFVPNPickerParameter`, and `WFVPNConfiguration`, all found in the macOS 15 dyld cache
(read over ssh to the mba). The iOS 27 plist key names for its parameters were not read.

## Recommendation

A Shortcut can switch between Tailscale and iFizBox VPN with no iOS prompt. So the cheapest safe fix for
"Tailscale stays off after an install" is for the app, after the tunnel goes down (`LocalVPN.end`), to run a
reconnect Shortcut that connects the previous VPN. Until the import or plist route is verified, that
Shortcut's VPN choice has to be picked by the user in the Shortcuts editor (Ask Each Time would prompt, so it
does not fit an unattended run). This is a lead for F386, not a decision.

Next research, queued as R77: read the real plist (through an iCloud link, or a Mac with the
Shortcut); test `WFWorkflowImportQuestions` with the Set VPN action; test Get Current VPN's output through
`x-success`.

## Method notes

- Shortcuts' New Shortcut opens an AI prompt on iOS 27; tap Edit for the classic editor.
- The action search field is at the bottom. Typing while the keyboard is up goes into the focused field.
- The test Shortcut "Set VPN" was deleted afterwards.
- Final phone state: Settings > VPN has Tailscale selected (checkmark) and Connected. Shortcuts holds only the
  Cellular Data On/Off Shortcuts again. The UI lock is released.

## Not verified

- A real `signing.resign` install under a Shortcut-selected VPN (only `vpn.test` ran).
- The "Add VPN Configurations" re-prompt (not reproducible on this phone).
- The iOS 27 plist keys for Set VPN's parameters.
- `WFWorkflowImportQuestions` with Set VPN.
- A signed `.shortcut` file (none made or imported).
- Get Current VPN (not run).
- A text-to-VPN lookup through Find VPNs that works (Name matching, other operators).
- A one-Shortcut version of the whole set.
- Behaviour on cellular (this phone has no SIM).
