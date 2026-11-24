# R100a: switch-back Shortcut (iPhone 15 Pro, iOS 27.0)

Measured 2026-11-24. Tailscale On Demand on. Restore My VPN off unless stated. Settings > VPN was never opened. State was read from idevice.status over Web Inspector and from the syslog.

## Summary (Go/No-go first)

**GO** for a switch-back Shortcut, using the signed plist (not a hand-built one). No plist change is needed.

- A Shortcut built by hand in the Shortcuts UI does not work. Its Back run never receives the stored VPN.
- The signed draft at `ref/shortcuts-signed` (`Restore My VPN Plain.shortcut`, legacy `setstoredcontent` / `getstoredcontent` actions from `gen.py`) works. Over 5 cycles, Tailscale went off when our VPN started and came back within 8 s after Back ran. No prompt appeared during the cycles.
- Answer to "does our next save or start ever show Add VPN Configurations, Allow or the passcode": with Restore My VPN off, only the very first save did (our configuration had been removed before; one tap on Allow). Every later save and start, 5 cycles, showed nothing. With it on, the first save after each removal asks again. A passcode prompt is untested: the phone has no passcode.
- The "GO" covers the signed plist only. For the hand-built Shortcut the answer is NO-GO: it failed twice and its cause is unknown, so it is weak evidence.
- Follow-up: the F task for this Shortcut already exists in the plan; see the Follow-up paragraph below.

Setup and use:

1. Store (`run {"store":1}`) with Tailscale connected. Allow the one-time "output 1 vpn" prompt with Always Allow.
2. Use the app (`vpn.test`), then run Back (`run {"back":1}`).
3. With Restore My VPN off, the saved configuration stays stored. The next saves and starts need no prompt.
4. With Restore My VPN on, the configuration is removed after each use. The next use then asks "Add VPN Configurations" and needs a tap on Allow.

Follow-up: queue an F task to bundle the signed "Restore My VPN" Shortcut. It should store before our first save and run Back after use or removal. Keep the signed plist as it is. Include a setup check, `run {"check":1}`.

## What was measured

Hand-built Shortcut (Shortcuts UI, iOS 27: Get Current VPN then Store Content "r100vpn"; a second Shortcut with Get Stored Content then Set VPN Connect): **failed**.

- The Store run showed an "output 1 vpn" prompt, which was allowed with Always Allow.
- The Back run said "No VPN was passed to the action", twice. The second store happened with Tailscale up.
- Cause not diagnosed. UI-built Store Content and Get Stored Content do not carry a VPN across runs.

Signed draft (`Restore My VPN Plain.shortcut`, imported on the phone from a Tailscale-served page via Safari download, Add Shortcut, Can Run When Locked):

- `run {"store":1}` with Tailscale connected: one "output 1 vpn" prompt, Always Allow, once at setup.
- Four cycles, with nothing stored between them, of `vpn.test` in the app then `run {"back":1}`:
  - Every `vpn.test` returned ok (kind rp, 145 to 241 ms).
  - Tailscale went off when ours started.
  - Back restored it (otherVPN true, tunnel utun5) within 8 s.
  - No prompt, alert or dialog appeared: no Add VPN Configurations, no Allow, no passcode.
- Cycle 5 ran after closing every app (Shortcuts included) and waking the phone. Same result.

Our configuration with Restore My VPN off:

- The first save needed an Allow on Add VPN Configurations, because the configuration had been removed earlier.
- The next four saves and starts needed no prompt. The app reloads the configuration on start.

Restore My VPN on:

- `vpn.test` removed our configuration after use, logged as "configuration removed". Tailscale stayed off.
- Back after the removal restored Tailscale. The stored-VPN order from R99 works.
- The next `vpn.test` after a removal showed "iFizBox Would Like to Add VPN Configurations". It needs an Allow tap.
- If nobody taps Allow within 90 s, the save fails with "saving the VPN configuration took over 90 s". This happened once, when the prompt was behind Shortcuts.
- So with Restore My VPN on, every use after a removal asks again. With it off, the prompt never returns after the first save.

Gotchas:

- Back must run while the app is not blocked on a prompt.
- A Shortcuts run brings Shortcuts to the front. The app goes to the background, and its web view cannot be inspected then.
- "Allow output 1 vpn" is a Shortcuts prompt. It appears once per Shortcut, at the first store.
- A store made while the other VPN is off stores nothing. The first hand-built failure may also have been a stale store.

## Not verified

- A Probe install (`library.install`) as the trigger instead of `vpn.test`.
- A VPN other than Tailscale.
- A passcode on the phone. The phone has no passcode, so a passcode prompt was never seen.
- Cellular.
- 20 or more cycles, or days later (a stored VPN across a reboot).
- The OpenForInstall / FinishInstalls variant (`Restore My VPN.shortcut` with app intents). It was not imported.
- The exact reason the UI-built Store Content failed.
- Why the first Restore-on `vpn.test` showed no Add VPN prompt. The configuration existed then and had not yet been removed.

## Phone put back

- Restore My VPN: off (as found).
- Tailscale: connected (otherVPN true, utun5).
- Our configuration: stored.
- UI lock released and apps closed.
- Left on the phone in Shortcuts: "R100 Store" and "R100 Back" (hand-built, not usable), and "Restore My VPN" (the signed Plain draft). Delete the first two when convenient.
- Screenshots: `ref/15/screens/r100-*.png` (not committed).
