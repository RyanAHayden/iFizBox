# F345b: native alerts (ui.alert) in the iOS 26 style

Plan: `journal/2026-11-21-f345-ios26-native-controls/README.md` ("Alerts and text prompts").

## What I did

- `web/app/nav/alert.js`: `showAlert` now asks `wantsNativeAlert()` first: the bridge takes calls, the alert has no
  countdown, and `<html data-controls="native">` is on (F345a's hook; it is only ever on under the iOS 26 style).
  Then it sends `ui.alert` `{title, message, buttons, cancel, colors, input?}` and resolves `{index, value}` from the
  shell's answer, running `onTap(index)` as before. `cancel` goes as -1 for a one-button alert (the CSS alert also
  draws no cancel then). `colors` is cleaned to `"red"`/`"green"` on real button indexes; `input.paste` is not sent.
  A rejected call (an older shell: "unknown method ui.alert", or no window) shows the CSS alert instead. The old
  body is `cssAlert()`, unchanged; the site, every other style and countdown alerts go straight to it.
  The hook is read inline (as `nav/progress.js` does) rather than importing `native-controls.js`, which pulls in
  `nav/switch.js`.
- `native/Sources/NativeAlerts.swift`: `ui.alert` presents a `UIAlertController(.alert)` on the top view controller
  (`MyIPAs.topController()`): the `cancel` index is `.cancel` (only that one: UIKit throws on a second cancel
  action), red is `.destructive`, the first green is `preferredAction`; one text field via `addTextField` with the
  placeholder, value and a keyboard from `type` (url, email, number, tel, password), no autocapitalisation,
  autocorrect or spellcheck, as the CSS field. Registered in `Bridge.swift`.
- `web/app/nav/alert-native.test.js`: the routing (params sent, answer, out-of-range answer), the fallbacks
  (countdown, no hook, the site, an old shell), and the Swift handler's shape.
- `docs/eras.md` "Native controls": a row for alerts.

## Tried and failed

(filled in below)

## Not verified

(filled in below)
