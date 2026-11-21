# B289: the Home Screen icon follows Theme > Mode

## What changed

- `web/app/core/settings.js` `iconState` reads `appearance` (Theme > Mode). With Mode Light or Dark, all three
  fields of `app.icon` (`light`, `dark`, `onScreen`) are `iconFor(mode)`: that tone's theme's icon, or that tone's
  App Icon pick when Match Theme is off. So a Mode Light app keeps its Light icon on a dark Home Screen. Automatic
  keeps the light/dark pair as before.
- `tellIcon` already runs on a Mode change: `screens/settings.js` calls `applyTheme` when `appearance` changes, and
  `applyTheme` calls `tellIcon(theme)`. The new message differs from the last one sent, so it goes out. No change
  was needed there or in `appicon.js`.
- The shell needs no change: `native/Sources/AppIcon.swift setName` maps `light == dark` to `Icon-<icon>`, and
  `native/icon/alternates.py` builds an `Icon-<icon>` set (one icon in both appearances) for every icon, Classic
  included. iOS 15-17 already showed only the tone on screen's icon.
- Theme > App Icon's Light and Dark previews (`appicon.js iconOf("light"/"dark")`) still show each tone's icon:
  they show what each pick is, not what the Home Screen shows.

## Tests

- `web/app/core/b289-icon-mode.test.js`: Automatic keeps the pair; Mode Light gives the Light theme's icon in both
  slots on a dark or light screen, and the Light pick when Match Theme is off; Mode Dark likewise; a Mode change
  makes `tellIcon` send `app.icon` again (pair -> single -> pair).
- `web/app/core/b289-icon-mode-apply.test.js`: the app's own path. With a jailbreak bridge, a Mode change from
  Automatic to Light on a dark iPhone makes `applyTheme` send the pair, then one icon; `init`'s
  `settings.onChange` still runs `applyTheme` on `appearance` (source check). It has its own file because the
  settings store reads the bridge when it is first imported.
- The existing icon and theme tests (`appicon.test.js`, `screens/appicon.test.js`, `theme-palette.test.js`) pass.

## Tried

- The phone check: I waited about 45 minutes for the 15 Pro's UI lock (`tools/ui-15.sh lock B289`). R53 held it
  first, then R45, and I never got it. My plan for it: set Mode Light in the installed app, send the new
  `app.icon {classic, classic, classic}` over Web Inspector, reboot, and look at the dark Home Screen.

## Not verified

- On the 15 Pro: Mode Light with the iPhone in Dark shows the Light icon after a reboot (and Mode Dark the reverse).
  Not run because the UI lock stayed held by other tasks (R53, R45) the whole session. Filed as R63, to run
  after this lands. The native side was read, not changed: `AppIcon.setName` maps light == dark to `Icon-<icon>`,
  and `alternates.py` builds that set for every icon.
- Spec review: fixed the missing coverage it found (picks on a dark screen, Mode change through `applyTheme`).
