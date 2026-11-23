# R75: phone check for B355 (Add Tweak… picker)

Result: **pass on both phones.** With `TWEAK_ACCEPT = ".dylib,.deb,.zip,.framework,application/octet-stream"`
the iOS document picker shows `.dylib` and `.deb` as pickable, and picking a `.txt` gives
"Can't Add This Tweak — R75Test.txt: add a .dylib, a .deb or a zipped .framework." No change to file.

Why a phone: the greyed-out state is drawn by iOS's own document picker (UIDocumentPickerViewController from
WKWebView's file input), which Chromium doesn't have.

## Test files

Three small files with only the names mattering: `R75Test.dylib`, `R75Test.deb`, `R75Test.txt` (made in the
scratchpad, removed from both phones afterwards).

## iPhone 7 (jailbreak app, iOS 15.8.8)

- The installed .deb (0.21.0-4305) had the pre-B355 `web/core/tweaks.js` (md5 equal to `fc66168c^`'s), and
  main's copy differs only in the accept line, so I swapped main's file in (backup, `sudo -n install`), closed the
  app from the switcher and reopened it. Files went to "On My iPhone/R75"
  (`/var/mobile/Containers/Shared/AppGroup/CB268B96-…/File Provider Storage/R75`).
- Path: Home > Install IPAs > Installed Apps > Calculator > Inject Tweaks > Add Tweak… > On My iPhone > R75.
- New accept: all three files bright (`r75-picker-7.png`); tapping the .txt gives the alert (`r75-alert-7.png`).
- Control with the old file restored: `.dylib` and `.txt` greyed, only `.deb` pickable (`r75-picker-7-old.png`).
  So on iOS 15 `.deb` worked before B355 too; `.dylib` is what B355 fixed.
- Restored the original `tweaks.js` (md5 `ad567f77…`, as found) and removed the test files.

## iPhone 15 Pro (Lite, iOS 27)

- Installed 0.22.0 (4420) still has the old accept: read through Web Inspector (`pymobiledevice3 webinspector cdp`,
  `Runtime.evaluate`): `[ "image/*", ".dylib,.deb,.zip,.framework" ]`. Rather than rebuild and reinstall (which drops
  the app's pairing and identity, see the rig notes), I set the live input's `accept` to main's value through Web
  Inspector: exactly the attribute B355 changes, on the same element.
- Files went in with `afcclient --container com.ryha.ifizbox -- put … Documents/R75/…` (shows as On My iPhone >
  iFizBox > R75).
- Path: Home > Install IPAs > Probe > Sign Options > Inject Tweaks > Add Tweak from Files… > On My iPhone > iFizBox
  > R75.
- Control first, old accept: `.dylib` and the `.txt` greyed, `.deb` pickable (`r75-picker-15-old.png`).
- New accept: all three show selection circles (`r75-picker-15.png`); even Downloads' `.ipa`, greyed before,
  became pickable. Selecting the `.txt` and Open gives the alert (`r75-alert-15.png`).
- Left Sign Options with the back button (no Save; it still says As Is) and removed the test files.

## Seen along the way

- With octet-stream every file can be picked (photos, IPAs); the name check after picking catches the rest, as
  B355 intended. No follow-up needed.

## Not verified

- A real tweak being added after picking a `.dylib`/`.deb`: the test files were dummies, so I only checked that they
  can be picked. Adding a real one is the picker-independent `prepareTweaks` path, covered by
  `web/app/core/tweaks-accept.test.js` and the existing tweak tests.
- The `.zip` / zipped `.framework` entries: not in the brief; not tried.
- The 15 check ran on the installed 0.22.0 build with the accept attribute set live, not on a build made from main;
  the 7 check ran main's `tweaks.js` inside the installed 0.21.0 app. Both test exactly the B355 change, but not a
  fresh build of everything else.
- Desktop browsers' file dialog with octet-stream (noted in B355's journal): still not checked; headless Chromium
  shows no dialog.
