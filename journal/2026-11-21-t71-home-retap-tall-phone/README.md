# T71: Home re-tap check on iphone-17-pro-max

## Finding

The check was wrong. Home does not redraw anything. On iphone-17-pro-max Home's list (`.page-body`, 956 px tall)
runs on behind the tab bar and the home-indicator inset below it. The tab bar's top is at 876 px. `HOME_ROWS` took
"above the tab bar" to mean `box.bottom - 60` = 896 px, which is right for a phone with no inset and 16 px short on
this one.

Before the push, Home's last rows (the version foot) sat below 896, so they didn't count as on screen. After
Why iFizBox or Settings is opened, the Why tile goes (F306), the rows move up, and the commit line's test point
landed at y = 878. The check counted that point as on screen, but `elementFromPoint` returned the Changes tab, so the
row was reported as "covered". I found this with a temporary dump of the hit element and the rects, since removed.

## Fix

`tools/concept/check.mjs` `HOME_ROWS` now measures the visible `.tabbar` and counts a row as on screen only above
its top. When no tab bar is showing, it keeps the old `box.bottom - 60`.

## Checks

- `node tools/concept/check.mjs <built page> --devices iphone-17-pro-max,iphone-se --modes jailbreak,sideload`
  (page from `tools/concept/build.py --standalone --before none`): `concept check: all clean`, exit 0. All 8 Home
  re-tap checks pass (both devices, both modes, light:classic and dark:gunmetal), and so do the drag and sandboxed
  checks. Before the fix, the same page failed 4 checks: every iphone-17-pro-max Home re-tap.

## Not verified

- `--version before` pages: I built only the after page (`--before none`). The changed code is the same for both.
