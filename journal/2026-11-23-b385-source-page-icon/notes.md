# B385: source page icon

Report: on the source page, the header artwork stretched over the whole screen, iOS 26 style, on the iPhone 15 Pro
(share.mp4 of B383).

## Cause

The header banner was not the cause. Neither iFizBox's own source nor SideStore Team Picks has `headerURL`, so no
banner is drawn there. The picture that filled the screen was an app row's icon.

F384 put app rows on the source page as `.cell-icon.alt-app-icon`. `.alt-app-icon img` is `position: absolute; inset: 0;
100%`, but `.alt-app-icon` itself was not positioned. Its other user, `.pkg-icon`, is `position: relative`, so the image
filled the nearest positioned ancestor, `.page-body`. Seen in iOS 6 and iOS 26; the rule is shared, so iOS 7
and 13 should have had it too.

## Fix

- `web/app/altstore.css`: `.alt-app-icon` gets `position: relative`.
- `web/app/screens/sourcepage.js` needed no change.
- New test `web/app/alt-app-icon-css.test.js` checks that `.alt-app-icon` and `.source-head-icon` are positioned and
  that their `img` is absolute. It passes. It also covers `.source-head-icon`, which has the same pattern.

## Checks

- Chromium, `tools/concept/build.py --standalone` and `check.mjs --probe` on iFizBox's own source page in Lite, iPhone
  17 Pro Max, iOS 26 dark OLED (`ios26:dark:oled`) and iOS 6 light Classic.
- A stand-in picture appended to the icon slot is 29x29. The iOS 26 screenshot shows the header card and the row right.
- With the slot forced back to static, the ancestors' computed positions show `.page-body` is the first positioned one.
- Reproduced at rest: with the slot static the picture measures 440x956, the whole screen, in both styles; 29x29 with
  the fix. A measurement 0.3 s after adding it gave 408x71 and 420x73, the row: the row was probably still sliding (a
  transform makes a containing block; inferred).

## Process notes

- The first look went to the header icon (`.alt-icon`). It reproduced with the correct 57x57 layout, so it is ruled out.
- `check.mjs` probes need an async IIFE. The iOS 26 dark theme is `ios26:dark:oled`.
- The CSS line and the test were written with `sed -i` and a heredoc rather than the editing tool. The result was checked.

## Not verified

- Not seen on the iPhone 15 Pro. The change is web-only CSS, and Chromium covers it under AGENTS.md's phone rule.
- Real icons from the network were not used: the concept page blocks them, so a drawn stand-in was used.
- A multi-app source such as Team Picks.
- iOS 7 and 13 styles, and iPad.
