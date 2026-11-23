# R77: Set VPN follow-up

Research only, no code. Written 2026-11-23, after F386 landed.

## Summary

F386 reached R77's goal by a different route, so two of the three tests R77 asked for are not needed. Install
Switch is one signed Shortcut. It connects iFizBox VPN for an install and reconnects the previous VPN after, with
no iOS prompt (checked on the iPhone 15 Pro, iOS 27; see `journal/2026-11-23-f386-install-switch`). The MBA was
offline for this task (`ssh mba` timed out), so nothing was signed or run on a phone.

| R77 asked | Answer |
|---|---|
| Read the real iOS 27 plist of a Set VPN Shortcut | Done by F386, from public sources and a real export, not from the phone. Keys: `WFVPNOperation` (Connect, Disconnect, Toggle, Set On Demand, Toggle On Demand), `WFVPN`, `WFOnDemandValue`. Find VPNs uses `WFContentItemFilter`. Get Current VPN takes no keys. Our own signed plist is `tools/shortcuts/install-switch.plist`. |
| Set VPN with a VPN picked at import (`WFWorkflowImportQuestions`) | Not tested, and not needed. Install Switch asks nothing at Add: the start run stores the current VPN, and the end run reads it back. |
| Get Current VPN output through `x-success` | Not tested. The Store Content route replaced it: Get Current VPN, Store Content "previous VPN", then Get Stored Content and Set VPN `WFVPN` as an ActionOutput token. It worked across a start run and an end run on the phone. |
| Find VPNs lookup by name from text | Not tested, and not needed. Install Switch finds iFizBox VPN by Server Address 10.7.0.1 (limit 1), which worked. R76's text-to-VPN conversion fails; it is not used. |
| One signed Shortcut, connect for an install, reconnect after, no prompt | Met by F386 (real install on the 15 Pro, Tailscale back and Connected after). |

## What is still open

- Set VPN on the stored VPN switches back but reports `NEVPNErrorDomain error 2`. The app treats it as done
  (`LocalVPN.switchEnded`). Reordering the plist (Delete Stored Content before Set VPN) would end the run clean.
  It needs a re-sign on the MBA, which was offline, so it is not done. It is filed as a follow-up.
- Everything F386 listed as not verified still stands: cellular actions (the 15 has no SIM), two or more
  installs on one start and end, the end run deferred while the app is in the background, a previous VPN other
  than Tailscale, another VPN on 10.7.0.1.

## Not verified

- A `WFWorkflowImportQuestions` entry with Set VPN: not run, because the MBA (the only signer) was offline and
  F386's route made it unnecessary.
- Get Current VPN through `x-success`: same reason.
- Find VPNs by name from text: same reason. Name matching ("iFizBox VPN" against the title or the app name)
  remains unknown.
- Nothing was run on a phone in this task.
