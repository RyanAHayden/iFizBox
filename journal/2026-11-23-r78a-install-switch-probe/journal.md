# R78a: Install Switch probe, task journal

Result and comparison: journal/2026-11-23-install-switch-no-flip/comparison.md

## What was done

1. Wrote a throwaway probe build in a scratch worktree under the session scratchpad, on branch
   scratch-R78a-probe. It was never merged.
2. The probe had App Intents for Connect VPN, a wait (N seconds, optional throw at the end), Open, and
   Notify (a local notification 3 s later, with willPresent set to banner, list or none). An in-app hook
   opened Shortcuts by x-callback as the Install Switch does, and a share sheet with a custom UIActivity row.
3. Wrote 20 Shortcuts as plists, signed them on the MBA (shortcuts sign), and imported each through the
   Add Shortcut sheet.
4. Ran the iPhone 15 Pro on iOS 27.1 over Wi-Fi. Measured the shared piece (Connect VPN, wait), the
   notification automation, the one-trip Shortcut, and the share sheet row.
5. Read the logs from `ios syslog`.
6. Put back: deleted the 20 probe Shortcuts and the probe automation, reinstalled the plain iFizBox build
   (native/build/iFizBox.ipa, built at 11:15) over the probe, set iFizBox notifications back to Off, and left
   Tailscale connected.

## What failed or was fixed on the way

- (a) The first NSLog lines never reached the syslog. The probe logs through the app's own IDevice.ilog.
- (b) The first signing failed because WFWorkflowClientVersion was a number. It must be a string.
- (c) A LocalizedStringResource availability error. It needs @available iOS 16.
- (d) The app had Notifications switched off, so the first notification test posted nothing (authorized=0,
  and no prompt). Fixed in Settings, then the test was run again.
- (e) One tap meant for Allow landed on the GitHub link and opened Safari. Harmless.
- (f) The Settings > Cellular page is not reachable on this phone (no SIM). So data on and off could not be
  observed. Only the VPN state and a marker action were checked.
- (g) The automation's Run Shortcut target was changed to the full switch Shortcut, to check for prompts.
- The phone lock for R78a was taken at 11:46 by a background poll and held until about 12:23. It was
  released with tools/ui-15.sh unlock.

## Not verified

- Cellular data: the phone has no cellular service (SOS), so every cellular effect is unverified. Only the VPN
  state and a marker action were checked.
- Airplane Mode as "no network": not tried. No cellular or Wi-Fi-off path was used.
- Screen locked: not tested for the intents, the Shortcuts or the automation.
- iOS 16 to 26: nothing was run there. The 30 s wait limit was measured on iOS 27 only.
- Option A, failure, timeout and kill: not measured. Restore after a kill is not measured.
- Option A, the trigger in a signed .shortcut: not determined.
- Option A, Focus (Do Not Disturb) blocking: not tested.
- Option A, a notification removed at once, a filter by title, and one automation for both messages: not tested.
- Option B (App Opened automation): not measured. Not needed, since A worked.
- Option C, restore on failure or kill: not tested on its own.
- Option D, the loop granularity with a real wait intent that returns at once when the queue ends: not measured.
- Other VPNs: Tailscale stood in for "another VPN up". No other VPN was tried.
- Wi-Fi only: no cellular path was used.
- The permission for iFizBox notifications and the app build that was on the phone before the probe cannot be
  restored, since the earlier build was replaced.
