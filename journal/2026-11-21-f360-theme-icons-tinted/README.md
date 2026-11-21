# F360 Theme icons follow Clear and Tinted on iOS 26+

## The problem

B309 gave only AppIcon (the default Classic/Gunmetal pair) a tinted appearance (the globe alone), so with a theme
icon set on screen (Match Theme with a non-default theme) iOS 26+ Clear and Tinted still drew its own opaque
one-colour copy of the whole picture.

## What I did

- `native/icon/alternates.py`: `set_files` adds a tinted appearance to every Icon-* set (all 73), at the Home
  Screen's 60pt @2x and @3x only (the brief's first try: a 1024 px picture in every set would add about 2 MB per car).
  The catalog names are `tinted-60x60@2x.png` (jailbreak car) and `tinted-lite-60x60@2x.png` (Lite car), so the
  existing "Lite files only in the Lite car" naming rule holds; the picture is the same in both (no sash, like
  AppIcon's). `tinted_src(pt, scale)` names the source PNGs.
- `native/icon/glass.py tinted` now also renders `icon/glass/AppIconTinted60x60@2x.png` (120 px) and `@3x` (180 px)
  from the same SVG as the 1024 px picture (which came out byte-identical, so it is unchanged).
- `native/icon/assets.sh mba`: both cars recompiled on the MBA (Xcode 26.3 actool, no warnings), `assets.sources`
  updated. Each car grew about 565 KB (Assets.car 23.04 -> 23.61 MB, AssetsLite.car 21.31 -> 21.88 MB): actool
  stores the two small renditions per set without sharing them across sets.
- `native/test_icons.py`: `test_every_set_tinted_is_the_globe_alone`: each set in both cars has exactly the two
  `ISAppearanceTintable` renditions with the build's names and sizes; the source PNGs are RGBA at 120/180 px.

## Check on the iPhone 15 Pro (iOS 27)

Built the Lite IPA from this branch (`native/build.sh ipa`), installed it with `tools/ui-15.sh install`, set Theme >
Light to Sepia (Match Theme on: the shell switched to Icon-sepia-gunmetal, iOS's "You have changed the icon" alert),
then the Home Screen's Customize:

| Look | iFizBox's icon (Sepia set on) | Shot |
| --- | --- | --- |
| Default | the Sepia picture with the LITE sash | `default-sepia.jpg` |
| Clear, Dark | the globe alone on the dark glass tile | `clear-dark.jpg` |
| Clear, Light | the globe alone on the light glass tile, like openMX and the others | `clear-light.jpg` |
| Tinted | the globe on the tinted glass tile | `tinted.jpg` |

So the 60pt tinted entries are enough for the Home Screen; no 1024 px picture needed. No reboot was needed.
Put the Home Screen back on Default and the app's Light theme back on Classic (icon back to AppIcon) afterwards. The
15 is left on this branch's Lite build.

## Tried and failed

- My first swipe to the Home Screen's page two landed in the App Library, and the first Home Screen shot still showed
  Classic: the icon switch only happens once the theme page is left (the alert came after going back to Theme).

## Not verified

- Settings, Spotlight and notification icons in Clear/Tinted with a theme set: only the Home Screen was checked (the
  brief's ask). Those draw smaller sizes; the alternate sets only have 60pt and iOS scales it down, as it already
  does for their normal pictures.
- Other theme sets than Icon-sepia-gunmetal on the phone: every set gets the same entries from the same code, and the
  test checks all 73 in both cars.
- iOS 18-25 Tinted: no such phone here (the 7 is iOS 15, the 15 Pro iOS 27).
- The jailbreak build on iOS 26+: no jailbroken iOS 26+ phone; its car has the same entries under the plain names.
