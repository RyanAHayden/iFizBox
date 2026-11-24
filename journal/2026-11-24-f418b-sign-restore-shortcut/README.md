# F418b: sign the Restore My VPN Shortcut

## Did

- `tools/shortcuts/sign.sh`: signs both Shortcuts (Cellular Installs and Restore My VPN), or one when KEY is given.
  All of them go over a single ssh connection, since the MBA sleeps and answers only for moments; a
  multi-connection signing timed out midway.
- `web/app/shortcuts/Restore My VPN.shortcut`: signed on the MBA (AEA1).
- `native/sideload/vpn/test_restoresigned.py`: test for the signed file.
- `tools/shortcuts/restore-vpn.plist`: Remembered VPN and Finish each appear once for all kinds of run, guarded by a
  Ready variable; Set VPN comes after Remembered VPN. RestoringVPNIntent is removed; RememberedVPNIntent reports both
  remembered() and restoring(), and each counts only in its own kind of run.
- `native/sideload/vpn/test_restoreshortcut.py`, `test_intents.py`, `mkipa.py`, `build.sh` and the intents README
  follow the new plist.
- The task's "restore-app" and "restore-plain" are drafts in `ref/`, superseded by `tools/shortcuts/restore-vpn.plist`.
  "Both Shortcuts" was read as Cellular Installs and Restore My VPN. Cellular Installs was not signed again.

## Found

- The signed F418 plist asked Allow again on the first back run, against the task. The iOS syslog saves the prompt as
  "mode: Normal, source: Settings (com.apple.Preferences), destination: iFizBox, count 1", per action UUID: an action of
  ours that runs after a VPN was read counts as sharing Settings' content.
- A "Nothing" before each own action did not help. It was tried, signed, tested and reverted.
- The change above is the fix that passed: Remembered VPN and Finish each appear once for all kinds of run, guarded by Ready.
- Opened by hand with no input, the Shortcut now runs Finish only, which counts for nothing.

## Tested

On the 15 Pro, iOS 27. Judged by the bridge answers. With the final signed file, except the missing Shortcut, no_vpn and
the plain-Allow lines, which ran with the first.

- Draft deleted; the new Shortcut added through the share sheet (opened true).
- Store with Tailscale up: one prompt (Don't Allow, Allow Once, Always Allow). Always Allow gave ok.
- First back run and two more: no prompt, back in the app, ok, otherVPN true, about 3.5 s each. Set VPN ended in
  NEVPNErrorDomain 2 in all of them (8 of 8 read in the syslog, counting the first plist's five), and the run still reported ok.
- The intent's report was logged (perform()) while the app was behind Shortcuts, about 3 s before "back done".
- Back run by link with Tailscale already up (Set VPN clean, Finish ran, x-success): returned without a prompt.
- Back with nothing stored: fresh copy, Tailscale off: prompt (Allow), not_stored, VPN untouched.
- Missing Shortcut: not_run, "Could not find the shortcut".
- Store with no VPN up: no_vpn. Back with Tailscale up: on_already.
- Earlier, with a first Allow given in a nothing-stored run, the later store run still asked. That first prompt is a
  plain Allow that covers no shared content.

## Phone left

Tailscale connected (as last read; a last store and back round did not run). The final Shortcut added (Allow given for the nothing-stored run; nothing stored). Final build
installed. Lock given back. Other Shortcuts untouched.

## Not verified

- Whether the last state's first store asks once more. The debug server had ended. The same order asked with the
  first plist.
- A clean Set VPN in a back run started by the app: error 2 every time so far.
- Allow Once, Don't Allow.
- The check run by the app (no bridge call for it).
- VPNs other than Tailscale. iOS 16-26. A locked phone. Cellular.
- Cellular Installs signed through the changed sign.sh. sign.sh's "local" path.
