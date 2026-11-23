# B360: cellular alert without Try Anyway

## What
- Removed Try Anyway from `ALERTS.cellular` in `web/app/core/installroute.js`. Buttons are now `["Use Server", "Set Up"]`, with `setup: 1` and no `idevice` index.
- `web/app/signing/route.js` `chooseRoute`: an alert with `setup` stops the install on Set Up and otherwise goes through the Signing Server (route `"server"`). The old `a.idevice` branch is gone; only the cellular alert used it.
- `decideRoute` still returns `{route: "idevice", alert: "cellular"}` unchanged.
- Test: `web/app/screens/installroute-f372.test.js` updated for the buttons, Set Up at index 1, and the Try Anyway case removed. It passes (12/12).
- `docs/sideload.md`: the cellular alert line now lists (Use Server or Set Up).
- Release note added: `release-notes/B360.md`.

## Failed attempts
- Nothing.

## Not verified
- The alert on a real phone on cellular (the 15 Pro) was not checked. It is a button-list change covered by the unit test, and a cellular test needs the phone off Wi-Fi.
