# F345a: iOS 26 style, native controls part 1

Plan: `journal/2026-11-21-f345-ios26-native-controls/README.md`.

## What I did

- **The hook.** `web/app/native-controls.js` (new): `drawsIos26Controls()` / `controlsFor()` decide
  `<html data-controls="native">`; only under `data-style="ios26"`, and only where WebKit draws iOS 26's controls:
  - in the app, the shell's `app.info` `ios` ≥ 26 (asked once by `initNativeControls()`, called from `app.js`);
  - on an iPhone/iPad (or an iPad asking for the desktop page: Macintosh + touch) with Safari's `Version/`, that
    version ≥ 26;
  - else, on an iPhone/iPad, `CSS.supports("anchor-name: --a")` (anchor positioning, first in WebKit 26).
  `theme-boot.js` runs the same rule before first paint (it can't import modules); `native-controls.test.js` runs
  theme-boot in a sandbox against every case and checks the two agree. A later change (Theme > Style, its preview,
  the app's own answer) is followed by a MutationObserver on `data-style`, and `nav/switch.js` `redrawSwitches()`
  swaps the switches on screen to the other kind, keeping state, data-* and onToggle.
- **Measured on the 15 Pro (iOS 27), in iFizBox's own web view** (pymobiledevice3 webinspector cdp, eval only): UA
  `iPhone OS 18_7`, no `Version/` (so the UA alone can't tell); `anchor-name`, `animation-timeline`,
  `contrast-color()` and `text-wrap-style: pretty` all supported; an unstyled `<input type=checkbox switch>` is
  **70.84 x 31** at any font size (it takes an explicit size too), `<progress>` 160 x 16.
- **Switch.** `createSwitch` under the hook returns `<input type=checkbox switch class="switch is-native">`: still
  a `.switch` whose state is `aria-checked` (callers in settings.js, signing-sheet.js, myipas.js and
  website-settings.js read and set it), so setting `aria-checked` moves `checked` without onToggle, and `change`
  updates `aria-checked` and calls onToggle. ios26.css's `--sw-w`/`--sw-h` are now 71 x 31 (WebKit's box) for both
  kinds; the look-alike's knob travels 40px.
- **Search field.** ios26.css: `appearance: auto`, the page's border/background reverted, 17px, `outline: none`
  (UISearchBar shows no ring; ≥16px also stops Safari's focus zoom); the label behind paints nothing.
  packages.css (layout): the label's 29px room for the drawn magnifier goes, the input's padding is WebKit's plus
  30px on the right, and the drawn clear button moves inside the capsule's right end.
- **Cell text fields**: plain borderless inputs with `appearance: auto`, 17px. **`<select>`**: `appearance: auto`
  with the browser's border/background. **Run page bar**: `nav/progress.js` builds a `<progress class="progress-bar">`
  under the hook (`p.progress()` sets its value); progress.css gives it the old track's 158px width.
- `appearance` / `-webkit-appearance` added to `ios6-css.test.js` `LOOK`, and docs/eras.md's Look list and a new
  "Native controls" section under Hooks.

### Shots (not committed: iOS status bar; in the main checkout's `ref/15/screens/`)

`f345a-native-light.png`, `f345a-native-dark.png` (OLED), `f345a-native-focus.png`, `f345a-native-clear.png`: this
branch's CSS injected as a `<style>` into the running app on the 15 Pro, with the real markup in a full-screen
overlay, then removed and the page's attributes put back. Native: iOS 26's wide-knob switch, the grey capsule with
the magnifier, the select's capsule with chevrons, the blue progress capsule, all dark under OLED Black; the
look-alike switch next to it is the same size. The fallback (no hook: the iPhone 7, desktop) rendered in headless
Chromium, light and dark, from the same markup: the 71 x 31 look-alike switch and the CSS search capsule.

## Decisions

- **Feature test: anchor positioning.** Safari 26 shipped it; iOS 15 (the 7) and iOS 18 WebKit don't have it.
  Desktop Chrome has it too, so the test only counts on an iPhone/iPad user agent. `Version/` wins over it when
  present (Safari keeps the real version).
- **No fixed-choice CSS menu exists today.** The CSS menu (`nav/menu.js` showMenu) is only used for long-press row
  actions (F345c's UIMenu), and the fixed pickers (Jailbreak, certificates) are action sheets (F345c). So the
  `<select>` swap is the CSS rule only, ready for the first fixed-choice menu built; docs/eras.md says "(none built
  yet)" for its look-alike.
- **The clear button stays drawn.** With WebKit's own cancel button un-hidden (temporarily, on the phone), iOS
  showed none, focused or not: so packages.css's drawn clear is kept and moved inside the native capsule.
- **Search field** needed layout changes in packages.css (padding is layout; ios26.css may only paint), and the
  progress bar a small change in nav/progress.js and progress.css; neither was in the task's file list.

## Tried and failed

- First Chromium fallback render came out blank: the markup extraction from the inject script failed (escaped
  backticks); wrote the markup to its own file instead.

## Follow-ups filed

- B314 (low): iOS 26 OLED Black's search bar Cancel shows a boxed border (packages.css's cancel edge tokens not
  cleared in ios26.css's dark block). Seen in the fallback and native alike; already there before this task.

## Not verified

- **The iPhone 7 (fallback) on the device.** Not run there: the 7's only part in this is that iOS 15's WebKit
  answers `CSS.supports("anchor-name: --a")` false and its app web view has no `Version/`, which node tests cover
  for its user agents; anchor positioning first shipped in WebKit 26. The fallback's look is ios26.css's existing
  look-alikes (only the switch box grew to 71 x 31), checked in Chromium per AGENTS.md's "phone only when Chromium
  can't check".
- **The real build on the 15 Pro.** The phone runs an older iFizBox. After the spec review I loaded this branch's
  `nav/switch.js` as a blob module in the app's web view under the hook: `createSwitch` gave an `<input>` with
  `switch` true and `appearance: auto`, `.click()` checked it, fired `change` (aria-checked "true", onToggle heard
  `true`), and `setAttribute("aria-checked", "false")` unchecked it without onToggle. Not run there:
  `redrawSwitches` on a live Theme > Style change, `nav/progress.js`'s `<progress>` and the `app.info` correction
  (node tests only).
- **A run page already open when the style changes** keeps the bar kind it was opened with (only switches are
  redrawn); the next run page picks the right one. Left as is: the page lasts one run.
- **The native switch's drag and the select's UIMenu** in this layout were not tapped (the F345 research tapped the
  select in the app and saw the glass menu).
- **iOS 26.0–26.x**: no such phone here; the rule assumes anchor positioning and the controls arrived together in
  WebKit 26.
- **An iPad** (the Macintosh + touch path): node tests only.
