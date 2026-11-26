# F447: Connect Through

Build concept K10 as approved, plus F446's native part.

On This iPhone in Lite, "Connect Through" lets everyone pick iFizBox VPN (built-in) or LocalDevVPN (App Store, https://apps.apple.com/app/id6755608044). A free Apple ID (profile without Network Extensions) gets LocalDevVPN only; the built-in row shows "Missing".

## What I did

- Recovered the concept's code from its published page, since the concept worktree was gone. The bundled modules were extracted from the control session's scratch localdevvpn.html and diffed against main. The change to screens/core was small: setupSteps(st, via), a Connect Through group, a localStorage choice.
- Kept the concept's rows, subtitles, footers and steps. The choice is stored natively, not in localStorage, because installs started anywhere (Re-sign, updates, queue) must use it.
- LocalVPN.swift: adds `vpn.setVia {via}`. `idevice.status` reports `vpn.via` as "builtin" or "app"; a profile without Network Extensions always reports "app".
- Each way in keeps its own Test Connection result: `ifizbox.vpn.tested` and `ifizbox.vpn.tested.app`.
- IDevice.Session.endpoint: skips LocalVPN.begin when routed through LocalDevVPN and connects to 10.7.0.1 when another app's IPv4 tunnel is up (VPNCheck.appUp, which reuses LocalVPN.otherVPNUp: any non-10.7.0.x IPv4 tunnel). Otherwise it fails with `vpn_app_off`: "LocalDevVPN is off: open it and tap Connect, then try again."
- vpn.test through LocalDevVPN: starts no VPN, verifies, and marks the app's test.
- waitForApp and waitOffCellular (airplane wait) are skipped through LocalDevVPN, since they hold the built-in VPN.
- Sideload and IDevice log lines name the way in (LocalVPN.routeName).
- Web core (core/installroute.js): VPN_APP, VPN_APP_LINK, viaApp, canConnect, ownVPN, routeVPN, setVia, APP_OFF, connectFooter, HOW_STEPS_APP and howSteps. iphoneSetUp, decideRoute, the status cell, setupState and verifyFailure use canConnect. otherVPNOn and restoreShown use ownVPN. Quiet Pairing Check through LocalDevVPN skips the VPN branches and runs only while LocalDevVPN is up (vpn.otherVPN) on Wi-Fi.
- Screen (screens/installroute.js): a Connect Through group under the status, shown only when the shell reports vpn.via. An older shell keeps the old Network Extensions "Missing" dead end. Tapping a row checks it at once and spins until vpn.setVia answers. LocalDevVPN's Set Up steps: "2. Turn On LocalDevVPN" opens the App Store page via app.openURL. No Restore My VPN and no On Cellular group through LocalDevVPN. After pairing, the automatic test runs only if LocalDevVPN is up.
- Tests: web/app/screens/installroute-f447.test.js (9 tests); native/sideload/vpn/test_vpn.py lists vpn.setVia.
- Chromium shots 1-4 (shot.mjs, fake bridge): built-in checked; tap on LocalDevVPN spinning; its steps; a free Apple ID with the Missing row.
- Docs: docs/settings.md, docs/sideload.md, GLOSSARY.md (new term Connect Through; Set Up Steps), release-notes/F447.md.

## Phone check

iPhone 15 Pro, iOS 27, under the tools/ui-15.sh lock. The branch IPA was built with the desktop's Swift 6.4.2 toolchain and iPhoneOS27.1 SDK and signed by the rig's paid profile, which has Network Extensions. LocalDevVPN was chosen by Connect Through, not forced by a free profile. Driven by WDA taps and Web Inspector.

- Tapping LocalDevVPN switched the page to its Set Up steps (shot 5). idevice.status: via "app".
- Test Connection with LocalDevVPN off: alert "Turn On LocalDevVPN". Text: "LocalDevVPN is off, so nothing can reach this iPhone. Open it, tap Connect, then try again." (shot 6)
- LocalDevVPN 1.3.0 opened, Connect tapped: Connected, Tunnel IP 10.7.1.1/32, Device IP 10.7.0.1/32. idevice.status then: otherVPN true, tunnels [utun5].
- Test Connection: Connected. Status Ready to Install "through LocalDevVPN" (shot 7).
- Install: a tiny test IPA (com.ryha.ifizbox.f447test, from the tiny fixture with a new Info.plist) was pushed into iFizBox's Documents with `ios file push`, then library.install {route: "idevice"}. OK in 1.0 s. Log: "Connected to iOS through LocalDevVPN (RemotePairing tunnel) after 0.1 s", "iOS installed F447 Test 1.0". The built-in VPN stayed off (vpn.on false).
- Re-sign: signing.resign {bundleId, route: "idevice"}. OK in 1.2 s; connected through LocalDevVPN after 0.2 s.
- Tapping iFizBox VPN switched back: via "builtin", its earlier test still counted, Restore My VPN and On Cellular back (shot 8).

## Tried that failed

- My first tap back to iFizBox VPN did nothing. The Test Connection "Connected" alert was still open and ate the tap. I dismissed it and tapped again.
- The phone build's log line "Using this iPhone's own install route through iFizBox VPN" named the built-in VPN even when routed through LocalDevVPN. Fixed in Sideload.swift after the phone run. Not re-run on the phone.

## Not verified

- A real free-Apple-ID profile build (no Network Extensions). The rig signs with the paid profile. The code path is the same (LocalVPN.viaApp is true when Network Extensions are not available), checked in unit tests only.
- The Sideload.swift log-name fix on the phone. It was built after the run; the IPA build compiled it.
- Quiet Pairing Check through LocalDevVPN on the phone (unit tests only).
- On cellular through LocalDevVPN: the airplane wait is skipped. Whether iOS refuses the connects there as it does with the built-in VPN is not measured.
- A long install (large IPA) with the app leaving the front: whether LocalDevVPN stays up through it.
- The App Store link tap on the phone. It opens via app.openURL; checked in Chromium and unit tests only.
- The gate in the slot skips the native build (no toolchain env). The IPA was built by hand with SWIFT_TOOLCHAIN and IOS_SDK set.

## Left on the phone

- This branch's build of iFizBox installed, with Connect Through on iFizBox VPN.
- The test app uninstalled.
- The test IPA deleted from iFizBox.
- LocalDevVPN disconnected.
- The lock released.
