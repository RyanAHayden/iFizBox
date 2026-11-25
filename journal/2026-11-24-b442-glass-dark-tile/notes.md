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
  other sets. Result: 37 run, 1 failure, `test_cars_compiled_from_the_current_pngs`, as expected until the .car
  files are recompiled.
- `native/icon/alternates.py`: comments only.

## Tried and failed

- The MBA is the only Mac with Xcode, and it is asleep or off. `ssh mba` gave "connect to host mbas-macbook-air port
  22: Connection timed out" over several tries, and a 4-minute retry loop too. Tailscale has listed it offline for
  about an hour. The LAN address answered "No route to host", no ping reply, and no MAC in the neighbour table, so
  there was no wake-on-LAN target.
- The iPhone 15 Pro was free, but there was nothing to install without the compiled .car.
- Not used: a macOS GitHub Actions job on the public repo. It would be a new published workflow the task did not ask for.

## Left

- `native/icon/assets.sh mba` on the MBA, then commit Assets.car, AssetsLite.car and assets.sources.
- Check with assetutil, and on the phone, that Clear and Tinted did not change. If they derive from the dark fill,
  pin their fill with a specialization.
- Home Screen shots on the iPhone 15 Pro: Default, Dark, Clear and Tinted beside system icons.

## Not verified

- That actool accepts the document.
- The .car files, and so the gate: it cannot pass until they are recompiled.
- All the iPhone 15 Pro shots listed above.
- iOS 15-25's flat render of the Glass icon.

## Stale wording

- The comments in `web/app/core/settings.js` still say Gunmetal for the Glass icon's dark look. That file is outside
  this task's changes and was left as it is.
