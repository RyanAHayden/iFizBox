# B350: red action-sheet buttons go down when tapped

User report: the red buttons in action sheets (Delete Review in the review sheet, Remove, Delete Account) never
looked pressed, while the other buttons did.

## Cause

- `packages.css`: `.action-button.destructive` set its background after `.action-button:active` with the same
  specificity, so the held background was lost.
- `.action-button` was not in app.js PRESSABLE, and `:active` alone is unreliable on iOS, so no `.is-pressed` was
  added either.
- In iOS 7, 13 and 26 dark, each era's `html[data-style=…][data-theme="dark"] .action-button.destructive` rule
  outweighed any held rule.

## What changed

- `app.js`: PRESSABLE gains `.action-button`, so every action-sheet button gets `.is-pressed` like the bar buttons.
- `packages.css`: new token `--action-destructive-pressed` for iOS 6, a gradient sampled from the 4S's
  UIAlertSheetDefaultDestroyButtonPressed art (centre column, rows 6-83 of the 92px @2x image), at the same stops the
  silver button uses, with white text kept. A held rule `.action-button.destructive:active,
  .action-button.destructive.is-pressed` now comes after the resting one. The plain and Cancel held rules also take
  `.is-pressed`, and the dark plain-button rest rule skips `.is-pressed`.
- `ios7.css`, `ios13.css`, `ios26.css`: `--action-destructive-pressed` in light and dark. Each era's plain held fill
  (#dcdcdc / #e5e5ea light, #2c2c2e dark; the iOS 26 anchored menu uses `--i26-menu-pressed`). The dark destructive
  rest rule gains `:not(:active):not(.is-pressed)`. Red text stays red while held in iOS 7, 13 and 26, as UIKit does.
- New test `web/app/destructive-press.test.js` checks the PRESSABLE list and the held rules. `node --test web/app`
  passes (3309).

## Check

`harness.html` + `shots.sh`: the app's stylesheets, an action sheet (Upgrade, Reinstall, Remove, Cancel) and the
iOS 26 anchored menu (Share, Delete), at 3x in every era and tone. `pressed=1` puts `.is-pressed` on Reinstall, the
red buttons and Cancel; Upgrade stays resting. `sheet.png`: rows iOS 6, 7, 13, 26; columns light, light held, dark,
dark held. Every red button goes down in every era and tone.

Found while checking: dark Cancel does not go down, because the dark cancel rest rule outweighs its held rule. That
was broken before this change and is not the red button, so it is filed as B367 and not fixed here.

## Not verified

- On a phone: Chromium covers the CSS, and the press path is app.js's existing one, now listing `.action-button`.
  AGENTS.md says phone only when Chromium cannot check.
- A real pointerdown in the running app adding `.is-pressed` to an action-sheet button: the shots set the class
  directly, and the test checks the PRESSABLE list.
- iOS 6 dark was shot only with the Gunmetal palette. The red button does not change with the palette.
