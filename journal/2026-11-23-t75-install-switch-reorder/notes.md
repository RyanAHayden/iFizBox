# T75: Install Switch forgets the stored VPN before Set VPN

## Summary

The end branch of **Install Switch** now deletes the stored "previous VPN" before the Set VPN that reconnects it.
On the iPhone 15 Pro (iOS 27), that Set VPN can switch the VPN back and then report NEVPNErrorDomain error 2, which
used to end the run before the delete (F386, problem b). The Shortcut was re-signed and checked on the phone. The
error 2 case itself did not happen in this check, so the fix rests on the plist order and the unit test.

## What was done

- `tools/shortcuts/install-switch.plist`: the end branch is now Get Stored Content "previous VPN", If has any
  value, Delete Stored Content "previous VPN", Set VPN Connect (its input is the Get Stored Content output, which
  still holds the VPN after the delete), End If. The comment above the Set VPN step says why the order matters.
  XML comments are dropped by the binary1 conversion, so later comment edits leave the signed file current.
- `native/sideload/vpn/test_vpn.py` (`test_install_switch`): checks that the action right before the last
  `vpn.set` is `deletestoredcontent`.
- `web/app/shortcuts/Install Switch.shortcut`: re-signed with `tools/shortcuts/sign.sh mba install-switch`. The
  script checked the AEA1 header.

## Phone check (iPhone 15 Pro, iOS 27)

Setup: Wi-Fi, Tailscale on and selected, driven through `tools/ui-15.sh` under lock T75. The phone was needed
because Chromium can't run Shortcuts or Set VPN.

1. The signed file was served from a scratchpad folder by `python http.server` on the desktop's Tailscale IP, port
   8099, and opened in Safari, then Download, Downloads, Add Shortcut. The app was not rebuilt. The Shortcut was
   added from the signed file directly.
2. The first Add offered Replace. After Replace, the phone had two Shortcuts named "Install Switch" (an older one was
   already there). Every run by name then failed with "The file doesn't exist. Could not find the shortcut
   "Install Switch."", even after Shortcuts was killed. Both were deleted and the new file was added once.
3. Runs went through `shortcuts://x-callback-url/run-shortcut`, with x-success and x-error pointing at the HTTP
   server, so the server log shows which callback fired:
   - `{"start":1}`: Settings > VPN showed iFizBox VPN checked and Connected. Its x-success reached the server only
     later, once Tailscale was back, since the tailnet is down while iFizBox VPN is on.
   - `{"end":1}`: x-success (end-ok), no x-error, no alert. Settings > VPN showed Tailscale checked and Connected.
   - A second `{"end":1}` right after: x-success (end2-ok). The stored VPN was already gone, so the If skipped
     Set VPN.

## What failed / was tried

- The MBA was offline at first (ssh timed out; Tailscale showed it last seen 22 minutes earlier). A poll loop
  found it back within 10 minutes and the signing ran then.
- Replace in Shortcuts left a duplicate name, so runs by name failed (see step 2). Deleting both and adding once
  fixed it.

## Not verified

- An end run started from the app (LocalVPN through a real install) with this signed file. The app bundles
  `web/app/shortcuts` and was not rebuilt or reinstalled.
- An end run where NEVPNErrorDomain error 2 does happen after the reorder. It did not show in these runs, so
  the order in the plist and the unit test are the only evidence that the delete now runs first.
- Anything on cellular (the 15 has no SIM).
- The old Cellular Data On/Off Shortcuts on the phone were left as they were.
