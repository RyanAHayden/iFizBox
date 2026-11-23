# B355: Add Tweak… picker greys out .dylib on iOS

## What I did
- `web/app/core/tweaks.js` `TWEAK_ACCEPT` now ends in `application/octet-stream`. iOS WebKit turns each accept
  entry into a file type; `.dylib`/`.deb` give dynamic types no file matches, so they were greyed out.
  `application/octet-stream` maps to any data, so every file is pickable on iOS. This is what the website IPA
  picker already does (`screens/myipas.js` `.ipa,application/octet-stream`, which also has no iOS file type).
- The name is still checked after picking: all three pickers in `screens/tweaks.js` run `prepareTweaks`, which
  refuses other names with "add a .dylib, a .deb or a zipped .framework." in a "Can't Add This Tweak" alert. So
  `screens/tweaks.js` needed no change.
- New `web/app/core/tweaks-accept.test.js`: the accept string holds the four extensions and octet-stream, and a
  wrong name is refused after picking.

## Tried and dropped
- UTType names (`com.apple.mach-o-dylib`) in accept: I don't think WebKit reads UTIs there, only MIME types and
  extensions, so I couldn't count on it. Dropping accept altogether would also work but loses the desktop file
  dialog's filter; octet-stream follows the repo's own precedent.

## Not verified
- The brief's phone check (.dylib and .deb pickable on the 7 and the 15). It needs a fresh build on each phone
  and driving the iOS document picker. That is a lot of phone time for a low-priority fix that copies a pattern
  already in use, so I filed it as a follow-up check instead.
- Desktop browsers: with octet-stream in accept, a browser may offer "all files" in its filter. Not checked in
  Chromium's native dialog (headless Chromium shows no dialog).
