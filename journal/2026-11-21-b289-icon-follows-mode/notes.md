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
- The existing icon and theme tests (`appicon.test.js`, `screens/appicon.test.js`, `theme-palette.test.js`) pass.
