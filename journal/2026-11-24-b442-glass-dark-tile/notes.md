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

## Tried and failed

- On 2026-11-24 the MBA was off: `ssh mba` timed out, Tailscale listed it offline, and the LAN address gave no route,
  so the .car files could not be compiled that day. A macOS GitHub Actions job was not used, since it would be a new
  published workflow the task did not ask for.

## Left

- Home Screen shots on the iPhone 15 Pro: Default, Dark, Clear and Tinted beside system icons. Held by B440 at the
  time, so waiting for it. Check whether the dark tile matches its neighbours, and whether Clear and Tinted are
  unchanged. If they changed, pin their fill with a specialization.
- Full gate.

## Not verified

- The phone shots listed above, including whether the dark tile matches its neighbours.
- Clear and Tinted pixels. Only the SizeOnDisk match is known.
- The full gate.
- iOS 15-25's flat render of the Glass icon.

## Stale wording

- The comments in `web/app/core/settings.js` still say Gunmetal for the Glass icon's dark look. That file is outside
  this task's changes and was left as it is.
