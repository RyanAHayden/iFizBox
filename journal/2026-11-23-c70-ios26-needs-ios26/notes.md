# C70: the iOS 26 style needs iOS 26

Done
- `core/settings.js`: `ios26Offered`, `ios26Here`, `setPhoneIos` (the shell's app.info `ios`; before it answers, CSS
  anchor positioning on an iPhone/iPad, as theme-boot.js). `settings.get("style")`, `themeState` and theme-boot draw iOS 6
  for a stored ios26 below iOS 26; `settings.optionsOf("style")` leaves ios26 out. `setPhoneIos` re-notifies "style" so
  applyTheme redraws when the answer arrives.
- `<html data-controls="native">` folded into `data-style="ios26"` (JS checks, packages.css, ios26.css under
  `[data-tabbar="float"]` to keep the rules' specificity).
- Removed: the CSS anchored menu (`menuSheet`, `placeMenu`, `.action-menu*`, `--i26-menu*`) and its two tests.
- Concept frame's fake bridge now reports iOS 26.0 so the style is offered there.

Kept on purpose
- The bottom sheet, `cssMenu`, the CSS alert (countdown/onTap), and ios26.css's look-alikes for switch art, segments,
  undo bar, spinner and tab pill: the concept frame (Chromium) and the transitions/popups need them, and the 15 Pro's
  look had to stay unchanged. The `.catch` fallbacks after a failed bridge call stay too (a menu that never opened).

**Not verified**
- On the 15 Pro (ios26 unchanged) and the iPhone 7 / fake bridge on iOS 15/18 in a browser: only node tests ran, no phone
  or Chromium pass (unattended; the logic is covered by native-controls.test.js and theme-palette.test.js).
- The `[data-tabbar="float"]` specificity swap in ios26.css was not compared in a render.
