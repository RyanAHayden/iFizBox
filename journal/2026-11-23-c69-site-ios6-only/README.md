# C69: The website is iOS 6 only

The other eras (iOS 7, 13, 26) now exist only in the two native apps, the jailbreak app and Lite. The site
shows iOS 6 and nothing else.

## What changed

- `web/app/core/settings.js`: the style setting has modes BOTH. In site mode, `createSettings` removes a stored
  `ifizbox.style`, and `get("style")` returns `ios6`. The era picker is gone from Theme on the site.
- `web/app/theme-boot.js`: honours a stored era only if `window.ifizboxNative` is set. On the site a stored era is
  ignored, so first paint is iOS 6. Its twin of the Safari check in `native-controls.js` is removed too.
- `web/app/index.html`: no longer links `ios7.css`, `ios13.css` or `ios26.css`.
- `web/app/era-css.js` (new): writes those three stylesheets with `document.write`, and only when the native bridge
  exists. The apps load them as before; the site never does.
- `web/app/native-controls.js`: the Safari Version/, iPad-desktop and touch paths are removed. Native controls are
  decided by the bridge only.
- `tools/concept/build.py`: treats `era-css.js` as a classic script and turns it into three style slots, so the
  concept frame's fake bridge still shows the eras.
- `tools/concept/check.mjs`: skips the era themes in the frame's Site mode.
- `docs/eras.md`: updated to say the eras are native-only.

## Tests

- `web/app/core/settings.test.js`: site mode has no Style rows, and a stored era is cleared.
- `web/app/screens/settings-eras.test.js` (new): the era tests moved here. They run as the jailbreak app with a
  bridge.
- `web/app/theme-palette.test.js`: boot takes a native flag. Site ignores a stored era. Link order is checked
  through `era-css.js`.
- `web/app/native-controls.test.js`: the Safari cases are removed.

## Tried and failed

- A `?app` second import of `screens/settings.js` inside `settings.test.js` does not work, because
  `settings-store.js` is a singleton. The era tests went into their own file instead.

## Checks

- `node --test web/app`: 3443 pass.
- Concept `check.mjs` in Chromium with the fake bridge: jailbreak mode comes up in the iOS 7 and iOS 26 themes with
  `data-style` as asked. Site mode skips the era themes.

## Not verified

- A real Chromium load of the site with `localStorage` `ifizbox.style=ios26`. The `theme-boot` unit test covers it
  with no bridge instead.
- The real apps (jailbreak and Lite) on a device. The bridge is injected at document start per
  `native/Sources/App.swift`, and this assumes it is in place before `theme-boot.js` runs. That was not run.
- Concept `check.mjs` in jailbreak mode under the iOS 7 and iOS 26 themes fails 3 Sources swipe/hold checks each.
  It also fails on main before this change. Filed as B388.
