# R68 Launch splash vs page on Dynamic Island phones (TopInset)

Question: F358 pins the launch storyboard's black status-bar strip to the safe area top, while the page's strip is
`--top-inset`, which F356's `TopInset` (native/Sources/App.swift) sets to the status bar's bottom when that leaves at
least 6 pt under the resting Dynamic Island. Does any phone pick the status bar's bottom, and how far apart are the
splash and the page there?

**Answer: no phone picks it, so the offset is 0 on every device measured. No fix is worth a task.**

## How

`sim/` is B180's harness (journal/2026-11-20-b180-launch-strips/sim) with App.swift's `TopInset` copied in:
`main.swift` reads the window's safe area top and `statusBarManager.statusBarFrame.height`, puts
`--status-bar-bottom` on `<html>` at document start, sends it again on `viewSafeAreaInsetsDidChange` (as App.swift
does), and writes the numbers it used (its `islandBelowSafe`, `margin` and `value` are byte-for-byte App.swift's,
checked with `diff` at commit time; `parts` is App.swift's `now` returning the inputs too) to `Documents/r68.txt`. `run.sh` screenshots the system launch screen at 3 s
(`SPLASH_WAIT`) and the page at 11 s, then copies the numbers out. Files staged on the MBA as `~/r68sim`: the harness,
`native/launch/LaunchScreen.storyboardc` and `Launch*@?x.png`, `web/app` minus `app.js`. MBA iOS Simulator, iOS
26.3 (the only runtime there), Xcode 26.3, light Classic, `APP_ID=com.example.r68island1`.

Measured at column x = 8 px: first non-black row (the strip's bottom) / the nav bar's bottom edge row.

| device | status bar (pt) | safe area top (pt) | TopInset (pt) | island margin (pt) | splash (px) | page (px) | offset |
|---|---|---|---|---|---|---|---|
| iPhone 17 Pro | 54 | 62 | 62 (safe) | 2.67 | 186 / 317 | 186 / 317 | 0 |
| iPhone 17 Pro Max | 54 | 62 | 62 (safe) | 2.67 | 186 / 317 | 186 / 317 | 0 |
| iPhone 17 | 54 | 62 | 62 (safe) | 2.67 | 186 / 317 | 186 / 317 | 0 |
| iPhone Air | 54 | 68 | 68 (safe) | −3.33 | black (see below) | 204 / 335 | 0 by construction |
| iPhone 16 Pro | 54 | 62 | 62 (safe) | 2.67 | 186 / 317 | 186 / 317 | 0 |
| iPhone 16 Pro Max | 54 | 62 | 62 (safe) | 2.67 | 186 / 317 | 186 / 317 | 0 |
| iPhone 16 | 54 | 59 | 59 (safe) | 5.67 | 177 / 308 | 177 / 308 | 0 |
| iPhone 15 Pro | 54 | 59 | 59 (safe) | 5.67 | 177 / 308 | 177 / 308 | 0 |
| iPhone 14 Pro | 54 | 59 | 59 (safe) | 5.67 | 177 / 308 | 177 / 308 | 0 |
| iPhone 16e (notch) | 47 | 47 | 47 (safe) | n/a | 141 / 272 | 141 / 272 | 0 |

"Island margin" is `statusBar − (safe − 32/3)`, the room `TopInset.value` checks against its 6 pt `margin`. The
status bar is 54 pt on every Dynamic Island model, and the safe area is 59, 62 or 68 pt, so the margin is at most
5.67 pt and `TopInset` always falls back to the safe area, the same line the storyboard pins to. No
`viewSafeAreaInsetsDidChange` resend changed the value on any device (`r68.txt` has only the load line).

## What that means

- F358's "Known gap" (docs/native.md, under the launch-screen table) is real only for a phone that doesn't exist yet
  in this Simulator: one whose status bar ends at least 6 pt under the resting island. Today `TopInset`'s
  status-bar branch never fires on an iPhone in portrait; in landscape the status bar is hidden (0) and it returns
  the safe area too.
- A storyboard fix would have nothing to fix, and it can't follow `TopInset` anyway (Auto Layout pins only to the safe
  area or the screen). If a future phone hits the branch, the splash's bar would sit `safe − statusBar` points lower
  (at least 6 pt less than the island's 10.67 pt clearance, so under ~4.7 pt on today's geometry) until the page
  takes over.
- No product fix. Only the docs wording: filed D25 (low) so docs/native.md says the gap is theoretical on every current iPhone (measured here),
  instead of reading like a known visible jump.

## What failed

- First run: the splash shots of iPhone 17, 16 Pro and Air were all black at 3 s (status bar drawn, nothing else).
  A rerun with `SPLASH_WAIT=5` gave 17 and 16 Pro their splash; Air stayed black. I didn't dig into SplashBoard's
  log for the Air: its `TopInset` is the safe area by the numbers above, so it can't show the offset this task is
  about.

## Not verified

- **iPhone Air splash**: black in both runs, so its splash rows weren't measured; the page uses the safe area (68 pt)
  there, the same line the storyboard pins to, so the offset is 0 by construction, not by pixels.
- **Real phones and other iOS versions**: only iOS 26.3 Simulator geometry. The iPhone 15 Pro on iOS 27 (F356) gave
  the same 54/59 pt; no 16/17 Pro hardware or iOS 27 simulator runtime is here, and a different iOS could change the
  status bar's height. Phone time isn't worth it for a 0 result on the Simulator.
- **Display Zoom / larger status bar modes**: not tried; the Simulator has no switch for Display Zoom in simctl.
- **Other launch sets than Classic**: only the bundle's own storyboard was rendered (as in F358); the strip's pin
  is the same view in every set.
- Left on the MBA, because this run deletes only inside its worktree: `~/r68sim` and the simulators "R68 16 Pro",
  "R68 16 Pro Max", "R68 16", "R68 15 Pro", "R68 14 Pro" (`xcrun simctl delete "R68 16 Pro"` etc. removes them).
