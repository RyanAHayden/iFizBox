# F368: airplane wait on cellular

## Did

- `native/sideload/idevice/IDevice.swift`: `LocalVPN.waitOffCellular` runs before each connect in `IDevice.install`, after the VPN is up. It waits for the path to leave cellular for 1 s, 5 min at most, and cancels through SignJob.
- The steps `airplane` and `airplaneOff` go to the page.
- The IPA queue holds "This iPhone" installs on cellular until every app is downloaded and signed (`allSigned`), because nothing downloads in Airplane Mode.
- "You can turn Airplane Mode off" shows only once every remaining app is connected, since each app opens its own connection.
- "On cellular, join Wi-Fi." is replaced by the airplane wording.
- A timed-out wait offers the Signing Server and is not remembered as a broken route.

Why not a Control Center event: the wait polls the path under KeepAlive and has no foreground/background handling.

`fake-cellular.patch` (beside this file): apply it, build the IPA, install it on the 15, never commit. Wi-Fi counts as cellular, so real Airplane Mode (with Wi-Fi off) ends the wait.

## Checked

- `node --test web/app/install-airplane-f368.test.js`: 6 pass. `node --test` in `web/`: 3472 pass.
- `native/sideload/vpn/test_vpn.py`: 11 pass.
- Sideload IPA: `make -C native ipa` built, `make -C native check` passed.
- After the spec review: Wi-Fi ending the wait no longer says Airplane Mode can go off, the single page keeps that line through the copy, the timeout has its own alert title and says iOS may have installed it once the install was sent. Core and signing node tests (1116 pass) and the IPA build ran again after that; a queue whose wait times out still starts the next app's wait.

## Failed or blocked

- The iPhone 15 UI lock was held by R87 (slot 1, touched 22:03) for the whole session. `tools/ui-15.sh lock` was refused, so no phone test ran.

## Not verified

- Nothing on a phone: the wait, Control Center over it, Airplane Mode ending it, Cancel and the timeout taking the VPN down, and the connection surviving data coming back. The 15 was locked by R87; the check is filed as F408.
- Real cellular: the 15 has no SIM. Whether `NWPath` still reports cellular with our VPN up is from reasoning only.
- Re-sign All's direct call (`signing.resignAll`) downloads each app in turn, so a second app's download needs data again.
