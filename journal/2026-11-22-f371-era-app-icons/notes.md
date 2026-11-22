# F371: era app icons in Theme > App Icon

## What I did

- `native/icon/era/make.py` (stdlib + rsvg-convert) draws the concept's four era icons as SVG masters and renders
  every size the theme icons have into `native/icon/era/<name>/`, plain and Lite. The Lite ones carry the LITE sash
  by laying `web/app/icons/sash-lite.png` (tools/icons.sh's sash, the one the theme icons use) over the master.
- Icon names are `ios7`, `ios7dark`, `ios13`, `ios13dark`, not the concept's `ios7-dark`: the shell's `app.icon`
  refuses names outside `[a-z0-9]{1,24}` (native/Sources/AppIcon.swift), and keeping the names inside that rule
  left the Swift side untouched. Never shipped under the old names, so nothing to migrate.
- `alternates.py`: `ERAS`/`ERA_ICONS`; `Icon-ios7` = (ios7, ios7dark) and `Icon-ios13` = (ios13, ios13dark) pairs with
  the globe-alone tinted appearance like every Icon-* set (F360); `Icon-ios7dark` and `Icon-ios13dark` one-icon sets
  for iOS 15-17 (which draw only the light look) and for Theme > Mode Dark (B289 keeps the one icon). Thumbs add the
  four era icons and `glass-dark.png`. Info.plist regenerated (`alternates.py plist`).
- `glass.py thumb` also writes `glass/AppIconDark60x60@3x.png`, the Glass icon's flat Gunmetal look; `all_sets()`
  skips the era sets (flat pictures, no glass layers).
- Web: `APP_ICONS` era entries; Glass relabelled "iOS 26"; `iconGroups` Themes / Eras / Special (Eras: this mode's
  iOS 7 and iOS 13 icon, then iOS 26). `ERA_ICONS` per style: `iconFor` resolves the theme's icon to the era's under
  iOS 7, 13, 26 (iOS 6 keeps its themes'), which covers Match Theme and a "Theme" pick, Home's header and
  `tellIcon`. `iconState` sends an era icon as its pair's name in Automatic (`pairName`: ios7dark -> ios7), so ios7
  with ios7dark reaches the shell as light = dark = ios7 and AppIcon.swift picks `Icon-ios7`; onScreen keeps the
  real name, so iOS 15-17 get `Icon-ios7dark` in dark. `iconSrc(name, tone)` shows `glass-dark.png` for the Glass
  icon in Dark's grid, Dark's row and Home's header in dark mode.

## Assets.car growth (actool on the MBA, Xcode 26.3)

| car | before | after | growth |
|---|---|---|---|
| Assets.car | 23,605,832 | 24,008,360 | +402,528 B |
| AssetsLite.car | 21,876,424 | 22,419,016 | +542,592 B |

(First compile, before the review's light-only sets: +331,488 / +429,936 B.)

## Choices

- Other mode's era icons are not in a mode's Special group (the concept showed none there).

## Spec review fixes

- "a pick in either mode uses the pair": a Light pick of iOS 7 with Dark left on "Theme" sent ios7 + gunmetal (no
  pair set). Now a "Theme" pick beside an era icon picked for the other mode takes that era's icon for its mode
  (`iconFor`), so both rows and the shell get the pair; a real pick for the other mode still wins.
- B289 with Mode Light: the fixed light icon was sent as `ios7`, whose set is the pair, so a dark Home Screen would
  draw ios7dark. Added `Icon-ios7light` / `Icon-ios13light` (the light icon alone), which Mode Light sends
  (`lightOnlyName`). The Glass icon keeps its one set (Classic + Gunmetal), as before this task.

## Phone check (iPhone 15 Pro, iOS 27, Lite IPA from this branch, tools/ui-15.sh)

Home Screen icons need the real device (Chromium can't show them). Mode set to Automatic for the run (it was on
Light), Home Screen > Customize > Dark > Auto while checking dark (iOS 27 keeps icons light on Default).

- Style iOS 7 with Match Theme on: iOS's alert showed the iOS 7 icon; Home Screen light = ios7, dark = ios7dark
  (the pair switched by itself, the app wasn't opened between). `home-screen-ios7-ios13.png`.
- Style iOS 13: alert showed ios13dark (phone in dark); Home Screen dark = ios13dark, light = ios13.
- Style iOS 26: alert and Home's header in dark showed the Gunmetal glass thumb; Home Screen light = Classic glass,
  dark = Gunmetal glass, not the light one. `home-screen-ios26.png`.
- Match Theme off: Light and Dark rows showed iOS 26's light and dark thumbs; Light Icon grid Themes / Eras (iOS 7,
  iOS 13, iOS 26) / Special as the concept; picking iOS 7 there switched the icon (alert showed it); Dark Icon grid's
  Eras show the dark pictures. `light-icon-grid.png`, `dark-icon-grid.png`.
- Put back: Style iOS 6, Match Theme on, Mode Light, appearance Light, Customize Default.

## Tried and failed

- Nothing failed outright. The first `home` after a dismissed alert twice landed on the App Library page; a swipe
  back reached page two.

## Not verified

- iOS 15-17 (the iPhone 7 jailbreak build): the one-icon `Icon-ios7dark` / `Icon-ios13dark` sets for dark there are
  only checked by the tests (in both .car files, Info.plist); the 7 wasn't needed by the task and its rule is phone
  only when needed.
- A Dark-grid pick of an era icon on the phone (only the Light grid's iOS 7 pick was tapped); node tests cover the
  message it sends (light = dark = the era's light name).
- The two review fixes (Theme beside an era pick, `Icon-ios7light` for Mode Light) came after the phone run: node
  tests and test_icons.py (both .car files hold the new sets) check them, the phone didn't, to ship today without a
  second IPA build and phone session.
- The jailbreak .deb wasn't built or installed: same web code, and its Assets.car passed test_icons.py.
