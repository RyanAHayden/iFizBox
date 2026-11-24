# R90: B418 check on the iPhone 15 Pro

## Did

- iPhone 15 Pro, tools/ui-15.sh, 2026-11-24, about 11:20-11:30, Wi-Fi. Tailscale connected as the VPN.
- Built the Lite IPA from task/R90 (main with B418) with `make -C native ipa`, saved as plain.ipa.
- Built a second IPA with the F368 fake-cellular patch. journal/2026-11-23-f368-airplane-wait/fake-cellular.patch no longer applies (the LocalVPN.swift line moved: B419 added `|| wifiAddress()`), so the same one-line change was made by hand in Path.now(): `return (wifi, false) // FAKE`. The source was reverted afterwards and the git tree is clean. The patch file itself is stale; a follow-up could refresh it.
- Test apps: a tiny-ifizbox.ipa fixture with other bundle IDs (com.ryha.ifizbox.r90a..f, never iFizBox's own ID), 3 x 40 MB and 3 x 250 MB of random padding. Put into the app's Documents with afcclient, then installed with Install IPAs > Manage > select > Sign and Install, over This iPhone.
- Run 1, fake build, 3 x 40 MB. This was a fresh rig install, so the log said "saving a new configuration (iOS asks to allow it)"; I tapped Allow. Then "on cellular: waiting for Wi-Fi or Airplane Mode" (the airplane wait ran, 74 s). Airplane Mode was turned on in Settings and the wait ended ("off cellular after 74 s"). All 3 installed, one "vpn: on in 0.22 s", then "vpn: off (nothing left to do)". No 'stale' and no failed row.
- Run 2, plain build, Wi-Fi, Tailscale selected and connected, 3 x 40 MB (rows already "Signed"). One "vpn: enabling the configuration", one "vpn: on in 0.21 s", all 3 installed, then "vpn: off (nothing left to do)". No 'stale'.
- Run 3, plain build, Wi-Fi, 3 x 250 MB. Same pattern: one "enabling the configuration", one "on in 0.17 s", 3 installed, "vpn: off (nothing left to do)". Tailscale may not have been the selected VPN at the start of run 3: a tap to re-select it after run 2 did not register, and this was not checked then.
- Put back: the plain build is installed on the phone; the 6 test apps are uninstalled; the 6 IPAs and their signed copies are deleted in the app; Tailscale is re-selected and connected (checked by screenshot); Airplane Mode is off. The lock is released (the unlock's tidy step printed "couldn't tidy the iPhone 15").

## Result

- B418's changes held in every run: no row failed with 'configuration is stale', and each run had one enabling and one start. The VPN went off after each run.
- The installs never overlapped. In all three runs every row started only after the row before it was installed, even with 250 MB IPAs, HERE_PARALLEL = 3, and all rows already signed (run 2). So the overlapping LocalVPN.up() calls that caused the user's 5-of-7 failure were not exercised, and the stale retry is unproven. Filed as R94.
- After every run iOS shows the iFizBox VPN as the selected VPN (our saved or enabled configuration takes the selection), not Tailscale, with status Not Connected. Tailscale had to be selected again by hand. This looks like iOS behaviour (one selected VPN), and is worth knowing for the Tailscale user.
- Side finding: after an out-of-band uninstall (`ios uninstall`), the Install IPAs page still lists the app under Installed.

## Not verified

- The stale retry on a real stale error (see R94 for overlapping installs).
- Overlapping installs (see R94).
- Don't Allow with several installs waiting.
- Real cellular: the 15 has no SIM. Airplane Mode with Wi-Fi counts as cellular only through the fake build.
- That Tailscale was the selected VPN at the start of run 3.
- A patched build with Tailscale selected at the start: run 1 started with the iFizBox VPN selected after the first save.
