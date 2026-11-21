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
- After the spec review: an alert with `onTap` also stays the CSS alert. The callers (free-apple-id.js `open()`,
  home.js `location.href`, signing/watch.js's itms-services link) need to run inside the tap's own user gesture,
  and the bridge's answer only comes after the tap. A red `cancel` button stays `.cancel` (UIKit allows one cancel
  action, and no alert in the page has a red cancel). The `docs/eras.md` row for alerts was taken back out (the task
  didn't list that file) and filed as a docs follow-up.

## Checked on the iPhone 15 Pro (iOS 27)

The Lite IPA from this branch's gate build, installed with `tools/ui-15.sh` under its lock. The style and theme were
switched and the alerts opened over `pymobiledevice3 webinspector cdp` (Runtime.evaluate on the app's page,
importing `nav/alert.js` / `screens/manage.js` and `settings-store.js`). Taps went through WDA. Afterwards Style,
Mode and the dark theme went back to what the phone had (iOS 6, Light, Gunmetal). Shots in the main checkout's
`ref/15/screens/f345b-*.png` (not committed: they include iOS's status bar and keyboard).

- **Red/green, light** (`f345b-redgreen-light.png`): Cancel / Keep (green) / Remove (red). iOS 26 draws a glass
  alert: Keep as the filled blue preferred button, Remove in red, Cancel last. Tapping Remove resolved `{index: 2}`.
- **Add Source prompt, OLED** (`f345b-addsource-oled.png`): the real `manage.js addSource()`. A dark glass alert
  ("Enter Source URL", its message, an `https://` field with the clear button, Cancel / Add Source), the URL
  keyboard (`/`, `.com`). Cancel resolved, so `addSource` returned `null`. Its Paste button is gone, as asked.
- **Text field value** (`f345b-input-oled.png`): Key ID-style alert with a green Next; typed `ab12` (stays
  lowercase: no autocapitalisation). The keyboard's Return resolved `{index: 1, value: "ab12"}`: Return taps the
  preferred action.
- **Return with no green button**: the Add Source alert's Return resolved `{index: 1, value: "https://"}`. UIKit
  tapped the last button, which matches the CSS alert's Enter.
- **The other two theme pairs** (after the review): Add Source in light (`f345b-addsource-light.png`, a light glass
  alert, Cancel resolved `null`) and red/green in OLED (`f345b-redgreen-oled.png`, a dark glass alert with a blue
  Keep, a red Remove and Cancel; Cancel resolved `{index: 0}`). The installed build's native code is the same as
  the final one: only `alert.js`'s `onTap` rule changed after it, and that is checked by the Node test.
- **Countdown alert** (`f345b-countdown-css.png`): `countdown` given, so the CSS alert showed (`.alert-scrim` in the
  DOM), "I Understand …" greyed out.

Chromium can't check this: the native alert exists only in the shell.

Side effect of the test: switching Mode to Dark/OLED (and back) made F323's theme-following app icon change, and
iOS showed its "You have changed the icon" notice each time. That's F323's own behaviour, not this task's.

## Tried and failed

Nothing failed.

## Not verified

- **A shell without `ui.alert`** on a real phone: no older build was installed to try it. The fallback (any rejected
  call shows the CSS alert) is covered by `alert-native.test.js` with a fake bridge that answers "unknown method".
- **The jailbreak build (.deb)** on the iPhone 7: the iPhone 7 runs iOS 15, where `data-controls="native"` is never
  set, so the native alert can't show there anyway. The .deb build compiles `NativeAlerts.swift` (the gate's native
  build passed).
- **iOS 26.0–26.x**: the only iOS 26+ phone here runs iOS 27.
- **An alert opened while another native alert is up**: the second one is presented from the first
  (`topController()` walks `presentedViewController`). I didn't try it on the phone.
- **The `onTap` rule on the phone**: the build on the phone has the earlier alert.js, where an `onTap` alert would
  still have gone native. The rule is covered by `alert-native.test.js`.
- **An alert dismissed without a button** never answers. UIKit offers no way to do that on a `.alert` controller
  short of the app dismissing it in code, which nothing does.
- **iPad popover/size classes**: no iPad here. A `.alert` style controller needs no popover anchor.
