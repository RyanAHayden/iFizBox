# B309 Clear icon on iOS 26/27: the primary icon follows the Home Screen

## The problem

In the Home Screen's Customize > Clear (iOS 26+), iFizBox's icon was an opaque white tile while every other app went
glassy. The primary icon (AppIcon) was a PNG set with a dark appearance and no tinted one, so iOS made its own
one-colour copy of the whole picture for Clear and Tinted: the light Classic starburst came out as a white tile.

## What I tried

Two ways, both compiled on the MBA (Xcode 26.3 actool) and installed on the iPhone 15 Pro (iOS 27) by swapping the
Lite IPA's Assets.car (`tools/ui-15.sh install`, which re-signs):

- **A: keep the PNG set, add an iOS 18 tinted appearance** (`"appearances": [{"appearance": "luminosity",
  "value": "tinted"}]` on a 1024 px entry): a white globe (Clear's bold lines and a faint face, 18% opacity) on a
  transparent background. actool keeps every PNG size (iOS 15-25 unchanged, LITE sash kept) and stores the picture as
  an `ISAppearanceTintable` rendition. ~30 KB more per .car.
- **B: AppIcon as an Icon Composer .icon** with `tinted` specialisations (no fill, rim at 0, sphere at 0.2): compiles,
  but as known from F324 it replaces the PNG set whole (iOS 15-25 would get actool's flat render, no LITE sash).

A was enough, so B was not needed and no DECIDE: on the 15 Pro, A gave exactly what the user asked for, with no
in-app pick and no reboot (the Home Screen redrew the icon when its look changed):

| Look | iFizBox's icon |
| --- | --- |
| Default | Classic picture with the LITE sash (the PNG) |
| Dark (Always) | Gunmetal picture with the LITE sash (the existing dark appearance) |
| Clear, Light | only the white globe, on the Home Screen's own glass tile, like openMX and the others |
| Clear, Dark | the globe on the dark glass tile |
| Tinted | the globe in the tint colour on the tinted glass tile |

Shots: `a-*.png` in this folder (taken from the swapped-car test build; the final build's are `final-*.png`).

## What I built

- `native/icon/glass.py`: `tinted_svg()` / `tinted()` (`glass.py tinted`) render `icon/glass/AppIconTinted1024.png`,
  the globe alone on transparent, from the Clear icon's grid layer plus a face at `TINTED_FACE` (0.18).
- `native/icon/alternates.py`: `primary_files` adds that picture as AppIcon's tinted appearance (named
  `AppIconTinted1024.png` / `AppIconLiteTinted1024.png` per build, since carfile.py's bundle check wants each build's
  icon files named for it; the picture is the same, no sash, like Clear).
- `native/icon/assets.sh mba` reran: both .car files recompiled, `assets.sources` updated.
- `native/test_icons.py`: both cars hold the tinted rendition (`ISAppearanceTintable`) beside the PNG sizes; the PNG
  is 1024 px RGBA.

## The in-app Theme > App Icon > Clear option

Stays. On iOS 26+ the primary icon now covers the Home Screen's Clear look by itself, so nobody there needs to pick
it. It still has a use on iOS 18-25 (no Clear Home Screen look there) and for anyone who wants the clear picture in
Default; removing it would also touch the web chooser, outside this task's files.

## Not verified

(filled in below as checks finish)
