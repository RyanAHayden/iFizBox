# R106: Restore My VPN from a Shortcuts automation

## Result

**No. Do not build it now.** An App Intent of ours ("Restore My VPN if due") in a Shortcut run by an automation
(App: iFizBox, Closed) works as a mechanism, but every run that actually switches from the built-in VPN to another
VPN ends with Set VPN's error after it has switched, and the automation posts a failure notification even with
Notify off. That is the common case for this feature, so users would see an error each time it works.
Today's Restore My VPN stays as the fallback.

Measured on the iPhone 15 Pro, iOS 27, Wi-Fi only, no SIM service, on 2026-11-27.

| # | Question | Answer | One line |
|---|---|---|---|
| 1 | Does the mechanism work | Yes | The trigger fires on leaving the app, the intent runs in a killed app and reads the restore state, with no Shortcuts screen and no prompt after setup. |
| 2 | Does the switch end cleanly | No | Every captured run that switched from the built-in VPN to another VPN ended with NEVPNErrorDomain error 2 after switching. |
| 3 | What would change the answer | A way to stop Set VPN raising error 2 | None known. Catching the action's error inside the Shortcut was not tried. |
| 4 | Effort to set up | About 14 taps and 2 typed searches | Plus first-run prompts. |
| 5 | Versions | iOS 27 only | iOS below 27 was not measured. |

## Setup

- Other VPN: Tailscale with Connect On Demand, stood in for an app's VPN. It is on demand only while selected;
  a run that was not due left it off.
- Throwaway build from a scratch worktree, never merged. One probe intent, "Probe Due", logs owed, remembered,
  LocalVPN.restore, LocalVPN.waiting, LocalVPN.state, LocalVPN.otherVPNUp and the pid. It answers due when
  (owed file or a force file) and not waiting and ours down. Most trigger runs used the force file.
- Restore My VPN's own setting was off (restore false) throughout.
- Probe Shortcut "R106 Due":
  - If it has input: Get Current VPN, store as "own VPN" (the store run).
  - Else: Probe Due, If has any value, get stored "own VPN", Set VPN Connect, End If.
  - Then: Nothing.
- Automation: App, iFizBox, Closed, with one action, Run Shortcut > R106 Due.

## Triggers measured

Automation App: iFizBox, Closed. Each row is one trigger with the built-in VPN selected.

| Trigger | Fired | Result |
|---|---|---|
| Home from iFizBox | Yes | Intent ran within about 1 s; the other VPN connected within about 7 s; no Shortcuts screen. |
| Switch straight to another app | Yes | VPN restored. |
| Lock the screen with iFizBox in front | Yes | VPN restored. |
| Open the app switcher | No | Did not fire by itself. |
| Swipe away in the switcher, iFizBox in front | Yes, when the switcher was dismissed | Did not fire while the switcher stayed open. iOS started a new background process of iFizBox for the intent (new pid); VPN restored. |
| Swipe away an iFizBox already in the background | No | It had already fired on leaving, so it did not fire again. |
| Open iFizBox | No | Closed only. |

- A fresh process after a kill read the real state from disk. A hand-written owed file "1" was read as owed true
  (nothing forced), the VPN was restored, and remembered was read true.
- Not due: no VPN change and no notification, when the intent returns a list (see gotchas).
- All expected triggers ran, including runs about 30 s after an erroring run. The syslog showed no rate limiting or
  debouncing for the lock run. R80's dropped-triggers effect was not seen here.

## Error 2 after a switch

- Every captured run that switched from the built-in VPN to the other VPN ended in NEVPNErrorDomain error 2 after
  the switch, and posted "Run Shortcut: The operation couldn't be completed. (NEVPNErrorDomain error 2.)" as a
  notification, with Notify off. Three of three were captured in the syslog. The first manual run did the same.
- Runs with Tailscale already up, or runs that were not due, had no error.

## Prompts and the automation editor

- At the first foreground run of the Shortcut, answered once:
  - 'Allow "R106 Due" to run actions from "iFizBox"?' (Allow)
  - 'Allow "R106 Due" to share 1 vpn and 1 text item with "Settings"?' (Always Allow)
- The earlier single-branch probe also asked 'Allow ... to access "Settings"?' (Always Allow).
- The automation runs after that asked nothing.
- The iOS 27 automation editor has no Run Immediately choice: only an "Automation" switch (on) and "Notify"
  (off by default). Saving also adds a Shortcut named "Run Shortcut" to All Shortcuts.
- Setup walkthrough: Shortcuts > Library > Automation > + > Edit > search "opened" > App > App field > search
  iFizBox > pick > Opened > Closed > search "Run Shortcut" > pick > Shortcut field > pick the Shortcut > Back.

## Shortcut gotchas

- An intent that returns an empty String still counts as "has any value": Set VPN ran on a not-due answer.
  Returning a list ([String], empty when not due) works.
- Stored content "own VPN" appears to be per Shortcut (inferred). A second Shortcut's Get returned "No VPN was passed"
  after another Shortcut had stored it, and also before. The same Shortcut stored it and read it back. So the due
  branch must sit inside the Restore My VPN Shortcut itself, not in a new Shortcut.
- With two installed copies of iFizBox, the app picker shows two identical "iFizBox" rows.

## Design points if built later

- The intent must clear the owed file and withdraw the question the page shows (restore.due).
- It must answer not due:
  - while an install runs (LocalVPN.waiting, in the same process);
  - while another VPN is up;
  - during iFizBox's own trips to Shortcuts, because Closed fires on every leave.
- RestoreDue.step holds the rules.
- The intent sits before the stored content read.
- Error 2 has to be solved before this is worth building.

## Phone left as found

- Automation and the four test Shortcuts deleted. The older R100 and Cellular Data Shortcuts were not touched.
- Probe files removed from Documents. Owed file set back to "0". iFizBox VPN selected, not connected.
- Plain build of this branch (1.0.5) installed over com.ryha.ifizbox (1.0.4 was installed before). Lock released.

## Not verified

- Leaving during a real install (LocalVPN.waiting true): no install was run.
- Restore My VPN's own back run and Cellular Installs trips firing Closed at the same time as their Shortcut runs:
  not run. Switching to another app fires Closed, so it is expected to.
- iFizBox's own update closing the app: not run.
- Restore My VPN setting on, with a real owed state made by an install: the owed file was written by hand.
- Force quit from a debugger, a crash or a memory kill: only the switcher swipe was tried.
- What an automation run does when the first-run prompts were never answered: the prompts were answered in the
  foreground first.
- Any way around error 2: none tried.
- VPNs other than Tailscale; cellular data; iOS below 27.
- The tap count of about 14 was not re-counted on a clean phone.
