# F429: Hidden Finish Asks

When an install put away with Hide ends and its finish is a restart, reload or reboot, an alert asks for it, so the
finish no longer waits for the page to be opened again.

## What was done

- `web/app/screens/queuerun.js`, `askFinish`: when `ended_` ends a run that was not cancelled, the page is hidden, and
  `choice.level` is in `TAP_LEVELS`, it shows an alert titled "Complete" (the page's own title) with the summary line,
  and the buttons Later and `choice.label`.
- Action shows the page, then runs the same one-shot action the page's finish button has. It is a shared promise: a
  second press waits for the first, and only a failed one (a truthy answer or a throw) can run again. Then the page closes unless
  the action failed.
- A strip tap, a retry, or the page closing aborts the alert through `showAlert`'s signal, so a late answer does nothing.
- Later keeps the strip and Show.
- `web/app/screens/queuerun-hidden-finish.test.js` (new). All pass with `queuerun.test.js` (36 tests together).

## How it was checked

- Chromium: `script.json` run by `journal/2026-11-23-F401-add-tweaks-queue/capture.mjs --mode jailbreak`, iPhone 402x874,
  fake bridge. `3-alert.png`, `4-action.png`. The action ran once ("restart"), the strip was gone, and the page closed
  after.
- Failed first: the capture's tap only looked in the top page, so the alert's button was reached by a selector that
  starts with `.nav-item`.

**Not verified**

- The run's packages in the Chromium shot came from a stub backend passed to `runQueue` (a real queue needs apt on a phone).
- No real respring or reboot on the iPhone 7. Web changes are checked in Chromium; the phone is used only when
  Chromium can't.
- The iOS 26 style's native alert (`ui.alert` / `ui.alertClose`) was not shot, as the shell draws it.
