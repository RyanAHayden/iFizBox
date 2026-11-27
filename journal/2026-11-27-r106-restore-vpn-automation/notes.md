# R106: Restore My VPN from a Shortcuts automation

Research task, no product change. **Parked and interim.** The iPhone 15 Pro is not on this desktop's USB
(`tools/ui-15.sh state` exits 69; lsusb lists no Apple device), so **nothing was measured** and there is no yes/no.
A later session resumes from the plan below. Everything here is desk reading of the repo and earlier journals.

## Question

Can an App Intent of ours ("Restore My VPN if due") live in a Shortcut that a plain Shortcuts automation,
"iFizBox Is Closed", runs with Run Immediately? The intent sets the remembered VPN back only when no install runs;
otherwise it leaves the **Restore My VPN** question to today's back run, or to the page on return.
Today's Restore My VPN stays as the fallback either way.

## Desk facts (not measured)

- A third-party App Intent cannot set a VPN. Set VPN is Shortcuts' own action, so the shape is:
  our intent returns due yes/no, then If due, then Set VPN (stored content "own VPN", as
  `tools/shortcuts/restore-vpn.plist`), then end If, then Nothing.
- A Shortcut whose last action has output makes iOS ask over the app, so the new Shortcut ends with Nothing.
  Today's restore intents return nothing for this reason.
- iOS asks Allow per action and per content source (journal F418b). Our intent goes before the stored content
  read, and each run is checked for prompts.
- State is in `native/sideload/vpn/App/RestoreBack.swift`. "owed" is a file in Application Support
  (`ifizbox.vpn.backOwed`). "remembered" and "never" are UserDefaults, which gave a stale read after our own update
  (F438a). "left" and whether an install goes on are memory only, so a freshly launched process runs no install.
- `RestoreDue.step` (`RestoreDue.swift`) is the rule set. It also needs ours down and no other VPN up.
  An intent that restores must clear owed and withdraw the question the page shows.
- Design hazards to measure: Is Closed may also fire when iFizBox opens Shortcuts itself (the back run of
  Restore My VPN, Cellular Installs), when the person leaves during an install that keeps running (then the intent
  must say not due), and maybe on iFizBox's own update.
- R80 (`journal/2026-11-23-install-switch-no-flip/automation-followup.md`): a Notification automation ran silently
  with the app killed and the phone locked, but its editor offered no Run Immediately choice. Triggers were dropped
  for a while after a run that ended in an error, so the action must not be able to error. Set VPN often ends with
  NEVPNErrorDomain error 2 after a switch (R100b), which matters here.
- The App trigger (Is Opened, Is Closed) has never been measured.

## Test plan (for the next session)

1. Lock with `tools/ui-15.sh`. Note the installed build, VPN state, and existing Shortcuts and automations.
2. Throwaway build from a scratch worktree, never merged: one probe intent that logs owed and remembered state
   through `IDevice.ilog` (read with pymobiledevice3 syslog) and returns due yes/no. Add its name to
   `SIDELOAD_INTENTS` in `build.sh` in the scratch copy only.
3. Probe Shortcut: probe intent, If due, stored content "own VPN" (kept by one store run of Restore My VPN),
   Set VPN, end If, Nothing. Build by hand, or sign on the MBA with `tools/shortcuts/sign.sh`.
4. Automation by hand: App, iFizBox, Is Closed only, Run Immediately. Record every tap for the walkthrough, and
   whether Notify When Run is offered.
5. With Tailscale as the other VPN and the built-in VPN current, measure Home, app switch, kill from the switcher,
   force quit while in background, and lock. For each: did it fire, did Shortcuts show, any banner or prompt,
   did the VPN change, did the intent run and read the state.
6. Hazards: leave during an install; Restore My VPN's own trip to Shortcuts; Set VPN ending in error (does a later
   Is Closed still fire).
7. Put everything back: delete the probe Shortcut and automation, reinstall the plain build, restore VPN state,
   unlock.

## Not verified

Nothing in this task is verified, because the phone is not connected. Open:

1. Does Set VPN run silently from the automation, with no Shortcuts switch and no Allow prompt?
2. Does Is Closed fire on Home, on app switch, and on a kill from the switcher?
3. Does our intent run while the app is closed or killed, and does it read the restore state?
4. **Yes/no for building it: not decided.** The setup walkthrough and the intent wait on items 1 to 3.
