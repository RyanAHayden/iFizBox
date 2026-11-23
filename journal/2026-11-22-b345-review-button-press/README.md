# B345: review buttons go down when tapped, and follow the era

User report: the review buttons (Write a Review, Report as Malicious, More Reviews…) didn't depress when tapped and
looked the same in every era.

## Cause

- They had only `:active`, which iOS fires unreliably; the bar buttons get app.js's `.is-pressed` (PRESSABLE).
- In dark, `html[data-theme="dark"] .review-button` outweighed `.review-button:active`, so dark had no held look at all.
- No era stylesheet had a rule for them, so iOS 7/13/26 showed the iOS 6 white gradient button.

## What changed

- `app.js` PRESSABLE gains `.review-button, .review-report, .review-delete-own, .review-tap-remove`. A one-line
  change outside the brief's file list, chosen over a second press tracker in reviews.js so the review buttons get
  the same 140 ms quick-tap hold, scroll cancel and one-at-a-time rule as the bar buttons.
- `reviews.css`: held look on `:is(:active, .is-pressed)`; dark keeps its theme's fill and lays
  `--dk-review-btn-held` (an inset shade, a palette token in ios6.css's dark block) over it. The small text buttons
  (Report, Remove, your Delete Review) fade to .5 while held.
- `ios7.css`: tinted outline button, filled with the tint while held (the era's price button). Text buttons tinted,
  .3 while held (the era's bar buttons).
- `ios13.css` / `ios26.css`: the table's fill (a white or #1c1c1e rounded button on the grouped page; 10px corners
  in iOS 13, a capsule in iOS 26), tinted 600 text, the price button's held fill.
- `review-press.test.js` checks PRESSABLE and the held/era rules.

## Tried and dropped

- Dark held look as `filter: brightness(.75)` (the dark back arrow's way): it dimmed the label to unreadable. Replaced
  by the inset shade.
- iOS 13/26 resting fill as the price button's grey (`--i*-get`): it vanished on the light grouped page. Now `--table`.
- First dark held shot came out lighter: the light held rule outweighed the dark one; the dark held rule now sets the
  dark fill itself.

## Check

`harness.html` + `shots.sh`: the app's stylesheets and the review markup, 3x, every era × tone, resting and held
(`.is-pressed`). `sheet.png`: rows iOS 6, 7, 13, 26; columns light, light held, dark, dark held. `node --test web/app`
passes.

## Not verified

- On a phone: Chromium covers CSS and the shared PRESSABLE path; no iOS-only behaviour here (AGENTS.md: phone only
  when Chromium can't check).
- A real pointerdown in the running app adding `.is-pressed` to a review button: the shots set the class directly;
  the press path itself is app.js's existing one, now listing these classes (test checks the list).
- Only Classic and Gunmetal palettes were shot for iOS 6; the held shade is the same token over every dark palette's
  `--dk-review-btn`.
- The sheet's red Delete Review (`.action-button.destructive`) still has no held look: a packages.css issue shared
  by every action sheet, filed as B350.
