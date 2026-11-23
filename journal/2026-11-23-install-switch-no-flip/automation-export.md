# R81: the Notification trigger in an exported .shortcut

## Result

Not determined, blocked on the owner. Checked 2026-11-23 on the desktop.

- `tailscale status` lists the iPhone 15 Pro nodes: ifizbox-on-iphone-15-pro offline (last seen 1 day ago),
  iphone-15-pro offline (3 days), iphone-15-pro-1 idle but not answering file transfer.
- The phone is on USB (`ios list` shows it). Taildrop from its share sheet needs its Tailscale node online,
  which only the owner can do by opening Tailscale on the phone.
- Not attempted without that node. The Taildrop route is phone to desktop, then `tailscale file get` on the desktop.

## What is known (from R80)

- The trigger is a separate WFNotificationTrigger-like row, not an action.
- A guessed top-level key holding the trigger was ignored on import.
- Save to Files and Copy iCloud Link fail without iCloud.

## Plan once the node is up

1. Make the automation by hand (about seven taps, see `automation-followup.md` in this folder).
2. Share the Shortcut from the share sheet to Tailscale, then to the desktop.
3. Run `tailscale file get` on the desktop.
4. Read the plist with `plutil` or Python `plistlib` (convert from the AEA or signed form if needed) and look for
   the trigger key.
5. Make a signed .shortcut with that key and import it.

Other untried routes:

- A Shortcut that runs Get My Shortcuts, then Save File to On My iPhone (no iCloud), pulled with `ios file pull`.
  Automations are probably not included in that export.
- Reading the trigger row from the Shortcuts database in an iOS backup (R80 did this for run history). That shows
  the stored form but not the export key.

## Not verified

- **The trigger key in an exported .shortcut.** Why: the phone's Tailscale node is offline, so no export reached
  the desktop. Only the owner can bring it online.
- **Whether an automation survives a Get My Shortcuts export.** Why: that route was not tried.
- **Whether an iCloud-signed phone exports differently.** Why: only a phone without iCloud was measured.
