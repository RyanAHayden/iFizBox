# F324 Real Liquid Glass app icon on iOS 26+

## What I did

- Checked the MBA first: `xcodebuild -version` (with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`,
  since xcode-select points at the CommandLineTools) said **Xcode 26.3 (17C529)**, actool 26.3. No update needed.
- `native/icon/glass.py` (new, stdlib only): writes an Icon Composer document (`<set>.icon/icon.json` + `Assets/*.svg`)
  for every icon set: `AppIcon` and every `Icon-*` set `alternates.py` lists (74). Layers, after tools/icon.svg.in's
  globe, flat as Icon Composer wants: `grid` (front group: meridian, three parallels and the outline, in the theme's
  ink), `sphere` and `rim` (globe group, translucent); the background is icon.json's `linear-gradient` fill from the
  theme's own ramp. All layers `glass: true`, groups `specular: true`. Colours come from tools/icon_themes.py's
  THEMES (the PNG icons' table), so a theme's glass icon matches its picture icon; Clear is white glass lines on a
  frosted white fill. A pair set's dark appearance is the dark theme's layers and fill through
  `image-name-specializations` / `fill-specializations` (key names taken from real Icon Composer documents on GitHub:
  mastodon-ios, Ladybird, QuickLookVideo); a one-icon set names the same icon for both.
- `native/icon/assets.sh`: writes the `glass.CAR_SETS` documents beside each catalog and passes them to actool with
  the .xcassets (works with macOS's bash 3.2 when there are none); `assets.sources` gets a `glass` digest line when
  CAR_SETS isn't empty, so a changed colour or set means a rerun. CAR_SETS is empty for now (below).
- `native/test_icons.py`: `Glass` checks one document per set, every layer image present, dark = the dark icon,
  layer order, colours per theme all different, SVGs well formed; the sources test includes the glass digest.

## actool trial (MBA, Xcode 26.3): the task's plan doesn't hold

Compiled a small catalog: `AppIcon.appiconset` + `Icon-sepia-nord.appiconset` (F323's PNGs) and `AppIcon.icon` +
`Icon-sepia-nord.icon` (glass.py), `--minimum-deployment-target 15.0 --target-device iphone`, both alternates named.
actool took the `.icon` paths as positional inputs beside the .xcassets, no warnings, and its partial Info.plist is the
same shape as today's. But `assetutil --info` on the .car showed:

- **The .icon replaces the same-named PNG set.** None of F323's PNG renditions (`AppIcon60x60@2x.png`,
  `sepia-60x60@2x.png`, ...) are in the .car. In their place actool stores its own flattened renders of the .icon at
  1024 px (`Icon Image`: Any, Dark, and two Tintable greys), and it writes `AppIcon60x60@2x.png` /
  `AppIcon76x76@2x~ipad.png` from the .icon too. So iOS 15-25 would get actool's render of the glass layers, not
  F323's PNGs, and the Lite build's LITE sash is gone (the .icon is the same in both builds).
- **About 3 MB per set.** The layer stack itself is tiny (SVG `Vector` renditions of 400-700 bytes, colours,
  gradients), but the flattened renders are about 600 KB (Any) + 600 KB (Dark) + 350 KB (Tintable) and come twice,
  for the phone and the pad idiom, even with `--target-device iphone`. The two-set car was 6.2 MB. All 74 sets would
  make each .car ~220 MB; F323 chose its 73 alternates for a 16 MB car.
- actool has no `--help`; I found no option to skip the fallback renders before the MBA dropped off again.

So "fall back to F323's PNG sets on iOS 15-25 in the same .car" can't be done with same-named sets, and a glass set
per theme pair doesn't fit. That's a choice for the user (blocked with DECIDE); see the options below. Until then
`glass.CAR_SETS` is empty: assets.sh writes and compiles no .icon, so the committed .car files (F323's) stay right
and nobody who reruns assets.sh gets a 220 MB car.

Options for the user:

1. **Primary only**: `AppIcon` becomes the .icon (Classic in Light, Gunmetal in Dark, real glass in Clear/Tinted on
   iOS 26+), ~3 MB more per .car. The cost: on iOS 15-25 the default icon is actool's flat render of the glass layers
   (Classic colours, no LITE sash). Every other theme's icon stays a PNG set (iOS 26 makes its own Clear/Tinted from
   the picture, as today).
2. **Separate glass alternates**: keep every PNG set as it is (iOS 15-25 unchanged, sash kept) and add `Glass-<x>`
   sets only iOS 26+ picks (AppIcon.swift change, outside this task's files). ~3 MB each: e.g. 4 sets (the default
   pair and three more) ≈ 12 MB per .car. The Lite build would show iOS's icon-change alert on the first switch.
3. Leave the PNG icons; iOS 26 keeps deriving Clear/Tinted from them.

My pick: option 1. It gives real glass for the icon most people have, costs one set, and needs no change to the
switching code. The price is the LITE sash on iOS 15-25 for the default icon only.

## The user's pick (2026-11-21) and what I built

The user chose: keep every PNG set as it is (iOS 26 makes their Clear and Tinted looks itself), and add **one** glass
icon as an extra choice in the icon chooser, Classic in Light and Gunmetal in Dark, as its own alternate, not
replacing AppIcon; then (a second answer) offer it on every iOS, older ones getting actool's flat copy.

- Showing it on iOS 15-25 needed no extra work: actool already writes the flat renders into the set, and the
  chooser's only gate was one I hadn't added. So Glass shows on every iOS (Clear keeps its iOS 18+ gate).
- `alternates.py`: `GLASS = "glass"`, `GLASS_SET = "Icon-glass"`; not in `sets()` (those are PNG sets), but
  `plist` lists it after them in Info.plist's CFBundleAlternateIcons, and `thumbs` copies its picture as
  `glass.png` for the page.
- `glass.py`: `all_sets()` adds `Icon-glass` = (classic, gunmetal); `CAR_SETS = ("Icon-glass",)`; `flat_svg` /
  `thumb` render the light look flat to `icon/glass/AppIcon60x60@3x.png` (rsvg-convert, committed) for the
  chooser's thumbnail, one picture for both builds (no LITE sash, like Clear).
- `assets.sh`: an .icon with no .appiconset of its own is passed to actool as `--alternate-app-icon` too.
  Reran `native/icon/assets.sh mba` (Xcode 26.3): Assets.car 19.9 -> 23.0 MB, AssetsLite.car ~+3 MB, as measured
  before. Each .car's `Icon-glass` holds `Icon-glass.iconstack` (Any/Light/Dark/Tintable) and the 1024 px Any, Dark
  and Tintable renders; every other set is unchanged PNGs.
- No Swift change: the page sends `app.icon {light: "glass", dark: "glass", onScreen: "glass"}` and
  `AppIcon.setName` already turns that into `Icon-glass` (no `Icon-glass-<x>` pair exists, so mixing Glass in one
  mode with a theme in the other falls back to the one-icon set of the tone on screen, as for any pair without a set,
  e.g. a dark theme's icon picked for Light). Pair sets with Glass would cost ~3 MB each, so I didn't add any; the
  Glass set itself already has both looks, so picking Glass for both modes is the way to get it in both.
- Web (outside the task's file list, needed for the chooser): `core/settings.js` `APP_ICONS` gets
  `{value: "glass", label: "Glass", tone: null}`, and `iconGroups` puts it in Special after Clear, on every iOS.
  `appicon.test.js` updated.
- `test_icons.py`: Info.plist and thumbs include Glass; `Icon-glass` in both cars; CAR_SETS is only it, it isn't a
  PNG set, it's the primary pair, the page offers it.

## On the iPhone 15 Pro (iOS 27, Lite IPA from this branch, ui-15.sh)

Needs the real device (Home Screen icons; Chromium can't show iOS's icon rendering). Installed the gate's
`native/build/iFizBox.ipa`; Theme > App Icon, Match Theme off, Light Icon: the grid's Special group shows
Clear, **Glass**, then the dark themes. Tapping Glass switched the icon (iOS's "You have changed the icon" alert,
drawing the new icon). Home Screen Customize, in turn: Default, Dark, Clear and Tinted all draw it as the system's
glass ([glass-looks-15pro.png](glass-looks-15pro.png)): Default the Classic blue fill with the lit globe, Dark the
Gunmetal layers (dark fill, navy globe), Clear and Tinted a clear glass tile with the white glass globe and specular
edge. Afterwards I put the phone back: Home Screen on Default, iFizBox's Match Theme on (the alert showed the sashed
default icon again).

## Tried and failed

- The MBA dropped off Tailscale three times this session ("offline, last seen 16m ago", `ssh mba`: connection timed
  out), once in the middle of the full `assets.sh mba` run ("Timeout, server mbas-macbook-air not responding"), even
  with `caffeinate -i -t 2400` started there. The full compile never finished that session; the small trial above
  did. On 2026-11-21 the MBA stayed up and the full `assets.sh mba` run finished (the committed .car files).

## Not verified

- iPhone 7 (iOS 15) and any iOS 15-25 phone: not checked. The theme icons are the same PNG sets as before (the .car's
  other sets are unchanged, test_icons.py checks every one), so the 7 still shows its PNG icon unless Glass is
  picked. Picking Glass there should show actool's flat render of it (seen in the .car only, not on a phone). I
  left the 7 alone: the 15 Pro covers the new part (the .icon set), and the 7 would need its own .deb install.
- The jailbreak build's quiet switch to `Icon-glass`: same code path as every other set, not tried on the 7.
- Glass picked for one mode and a theme for the other: goes to the one-icon set of the tone on screen (the existing
  rule for a pair with no set); reasoned from AppIcon.setName, not tried on the phone.
- The chooser in Chromium (fake bridge): not shot; the 15 Pro showed the real grid with Glass in it.
