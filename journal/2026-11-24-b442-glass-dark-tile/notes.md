# B442: the iOS 26 icon's dark tile is iOS's own

## What I did

- `native/icon/glass.py`: `document()` takes `system_dark`, and `write_icon` sets it for the Glass set (Icon-glass)
  only. Its dark fill is `"system-dark"` instead of Gunmetal's gradient. The spelling is taken from real Icon Composer
  documents on GitHub (Signal-iOS, UTM, HandBrake). The dark layers are still Gunmetal's globe: light blue rim, navy
  sphere, near-white grid. The light fill and every other set's document are unchanged. No clear or tinted
  specialization is written.
- `native/icon/glass/AppIconDark60x60@3x.png` (the dark thumb) is redone: the same globe on a `1f1f1f` to `0f0f0f`
  gradient, sampled from the Mail and Claude tiles in the user's Home Screen shot. On it the rim, sphere and lines
  are clear. The light thumb came out byte-identical, so git shows it unchanged.
- `native/test_icons.py`: the dark-appearance test expects `"system-dark"` for Icon-glass and the gradient for the
  other sets.
- `native/icon/alternates.py`: comments only.
- Spec review: no definite code error.

## Compiled on 2026-11-25

- `native/icon/assets.sh mba` on the MBA compiled Assets.car and AssetsLite.car with no actool complaint. That
  settles the earlier question of whether actool accepts the document.
- `test_icons.py`: 37 run, all OK.
- `assetutil --info`, old vs new Assets.car: 1168 renditions each. Only Icon-glass differs. Its dark render is
  smaller, and its two dark fill colours are now system grey 0.192 and 0.078. Its Any and Tintable renders have new
  names and digests but the same SizeOnDisk, which suggests but does not prove identical pixels; assetutil cannot
  read the icon stacks. No other set's entries differ.
- Lite IPA built from the branch.

## Phone check (iPhone 15 Pro, iOS 27, Lite IPA from this branch, 2026-11-25)

Home Screen icons need the real device. The phone was already in Style iOS 26 with the Glass icon and in Dark. Home's
header showed the new dark thumb.

- Customize > Default, Dark (Auto), Clear (Light), Tinted (Light), shot with the sheet open:
  `journal/2026-11-24-b442-glass-dark-tile/home-screen-15pro.png` (left to right). The dark tile measures `1f1f1f` at
  the top to `0e0f0e` at the bottom, the same as Files beside it (`1f2020` to `101010`). The globe is legible.
- Then installed a main build whose Assets.car is main's AssetsLite.car (matched by sha256) and took the same shots:
  `journal/2026-11-24-b442-glass-dark-tile/before-after-15pro.png` (old left, new right; rows Default, Dark, Clear,
  Tinted). Default and Tinted are pixel-identical. Clear differs by 4.3 levels on average in the icon, but untouched
  neighbours differ too (2.6 to 8.4: OpenTennis, PartyBoard, Files...), and the wallpaper is 0. That is a difference in
  how iOS drew the glass in the two shots, not a change in the icon.
- Put back: Customize set to Default; the phone keeps the main build.

## Not verified

- Clear and Tinted with the sheet's Dark choice: only Light was taken.
- iOS 15-25's flat render of the dark look.
- The dark picker grid: only Home's header was seen, which is the same file.

## Stale wording

- The comments in `web/app/core/settings.js` still say Gunmetal for the Glass icon's dark look. That file is outside
  this task's changes and was left as it is.

## Gate

- The first `done` failed on `web/app/core/blocked.test.js`: a fixed date in it had gone out of the week it needs. Main
  had already fixed that (`dayGroups` gets `now`); this branch takes main's copy of the file, nothing else from main.
