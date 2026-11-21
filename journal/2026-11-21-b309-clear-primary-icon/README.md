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

## Checks on the phones (the gate's builds from this branch)

- **iPhone 15 Pro (iOS 27)**: installed the gate's `iFizBox.ipa` (its Assets.car md5 = the committed
  AssetsLite.car), rebooted first (`ui-15.sh reboot`), then Customize in turn: `final-default.jpg` (Classic + LITE),
  `final-dark.jpg` (Dark, Always: Gunmetal + LITE), `final-clearlight.jpg` and `final-cleardark.jpg` (the globe alone
  on the glass tile), `final-tinted.jpg` (the globe in the tint). Put the Home Screen back on Default afterwards. The
  15 is left on this branch's Lite build.
- **iPhone 7 (iOS 15.8.8)**: installed the gate's `iFizBox.deb` (`apt-get install`; it was on 0.17.3-3159, now
  0.19.1-3913 from this branch; the app's Assets.car md5 = the committed Assets.car). Home Screen: the normal Classic
  picture icon (`iphone7-ios15.jpg`, the right-hand iFizBox; the left one is the web app with its WEB sash).

## Tried and failed

- The first car named the tinted picture `AppIconTinted1024.png` in both builds: `carfile.icon_problems` (the
  mkipa.py bundle check) refused it in the Lite car as "the jailbreak build's icon". Renamed per build and recompiled.
- The first gate run failed the size guard: the journal's PNG shots were 1.3 MB each; now ~30 KB JPEG crops.
- The MBA timed out on the first `ssh mba` (asleep: Tailscale showed it "active" with rx 0); it answered a minute
  later, and `caffeinate` kept it up.

## Follow-up filed

- F360: the same tinted appearance for the theme icon sets (Icon-*), so a phone showing another theme's icon also
  goes see-through in Clear. Out of this task's scope (the brief asks for the primary icon).

## Not verified

- iOS 18-25 Tinted (and Dark) on a real phone: no iOS 18-25 device here (the 7 is iOS 15, the 15 Pro iOS 27). iOS 18
  reads the same tinted appearance, so its Tinted look should show the globe too; not seen.
- The Settings, Spotlight and notification icons in Clear/Tinted: only the Home Screen was checked (the brief's ask).
- The jailbreak build on iOS 26+: no jailbroken iOS 26+ phone; it has the same AppIcon set as the Lite build minus the
  sash.
- The iPhone 7 in Dark Home Screen mode: iOS 15 has no icon appearances, so nothing to check.
