# F408: F368's airplane wait checked on the iPhone 15 Pro (iOS 27)

## Did

- `web/app/core/apprun.js`: `rowProgress` counted the `airplane` and `airplaneOff` phases as iOS's install, so the run's bar went to 60% at the wait. The bar never goes back, so the whole copy (50-60%) did not move it. Now the bar is 50% at the wait.
- `web/app/install-airplane-f368.test.js`: covers the 50% value. Checked by the unit test only, not on the phone.

## Checked on the phone

Build: 0.27.0 IPA with `journal/2026-11-23-f368-airplane-wait/fake-cellular.patch` applied (Wi-Fi counted as cellular). Never committed.

Why the phone: the VPN, the RemotePairing install and Airplane Mode need the device.

Test IPAs `f368one` and `f368two` (1 MB) and `f368big` (900 MB random padding) under `com.ryha.ifizbox.*`, made from `tiny-ifizbox.ipa` with another bundle ID, put in Documents with `afcclient`, installed from Install IPAs.

- Wait: "Turn on Airplane Mode to install" shows, VPN on in 0.10 s, for one app and for two queued.
- Cancel at the wait: 22:25:43 cancelled, VPN off 3 s later (linger), queue back on Confirm.
- Control Center held open over the wait for about 25 s: the wait kept. Airplane Mode turned on in it (Wi-Fi went off with it). Both apps connected and installed with Control Center still open, about 4 s after the tap. VPN off 3 s later.
- 5 min timeout: 22:28:01 to 22:33:01. Fails with the `airplane_timeout` text, offers the Signing Server and Retry All. VPN off 3 s later.
- Retry All: Airplane Mode on at 22:34:26, "You can turn Airplane Mode off" shown during the copy. Airplane Mode off (Wi-Fi back) at 22:34:28-31, early in the 900 MB copy. The copy ran on one connection at 23.9 MB/s, 37.7 s, no reconnect. Installed 22:35:13. VPN off.
- Native files needed no change.

## Failed along the way

- A Control Center swipe opened on the music page or was tapped mid-animation, so the first Airplane Mode taps landed on AirPlay. Nothing was played or cast. This became the timeout test.
- Tap the heart at the right edge to get page one. Take a shot before tapping.

## Put back

- Test apps uninstalled. IPAs and signed copies removed from the app's folders.
- Airplane Mode and VPN off.
- Unpatched build (with the bar fix) installed and launched. Lock released.
- Signing's `signed.json` still lists the three test apps, like the other test apps there.

## Not verified

- Real cellular: the 15 has no SIM. Whether `NWPath` still reports cellular with the VPN up, and whether iOS refuses or accepts the connects there, is not known.
- The 15's own "turn data back on" was Wi-Fi, not cellular data.
- A drop and reconnect mid-copy that waits again did not happen.
- R87 held the iPhone 15 UI lock before F408 and is still an open task. Whether installing over its iFizBox build (5027) matters to it was not checked. The lock was released and Instagram was untouched.
