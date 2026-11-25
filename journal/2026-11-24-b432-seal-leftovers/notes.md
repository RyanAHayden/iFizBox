# B432: what installd refuses in a seal (0xe8008017)

Procreate Pocket is refused by installd with 0xe8008017, "A signed resource has been added, modified, or deleted",
at `Payload/Procreate.app`. The IPA is not here, so the causes were found by building test IPAs.

## Method

- About 90 IPAs built from tiny-ifizbox.ipa's binary (ID com.ryha.b432test), one oddity each.
- Signed with signbench-linux (our signer) and the ad hoc wildcard profile.
- Installed on the iPhone 15 Pro (iOS 27) with `pymobiledevice3 apps install`. Its installd staging path is the one in
  the user's screenshot. Only installd decides, so the phone was needed. The test app was removed after.

## What gives 0xe8008017

Each one reproduced the error exactly:

- At a bundle's root (app or framework): `_CodeSignature/<anything but CodeResources>`, `CodeResources` (file, symlink
  or folder) and `_MASReceipt/`. iOS skips these in its scan, so a seal that lists one names a file it can't find.
- `foo.DS_Store`: the seal leaves it out, but iOS only skips the exact name `.DS_Store`.
- Entry names with `./` or `//`: installd reads them as the short name, so the seal and the file names differ.
- NFC and NFD spellings of one name: the phone's APFS treats them as one file, while the seal and the zip spell them
  differently.
- Names starting with a combining mark, ZWJ or a variation selector: Swift's `hasPrefix` works per Character, so
  `/` plus the mark is one Character and the entry is not sealed.
- A composed (é) non-ASCII CFBundleExecutable: iOS looks for the decomposed name. The decomposed one passes.

## Checked, not causes

SC_Info/, duplicate entries, non-UTF-8 names and names without the UTF-8 flag, symlinks (broken, to a directory, in an
.lproj), Base.lproj, locversion and `.lproj` folders, mode 000, ResourceRules.plist, AppleDouble `._` files, control
characters, newlines, `Icon\r`, names differing only by case, a nested CFBundleExecutable path, asset packs, dSYM,
a nested `_CodeSignature` in a plain folder, percent signs, spaces and emoji, and frameworks inside frameworks.

Two shapes fail earlier, at extraction (PackageExtractionFailed), so they are another error: a file and a folder with
the same name, and a folder entry whose name has no "/" at its end. An absolute symlink target and a `Resources/` folder at the app's
root are refused for other reasons too.

## Fix

- `native/sign/SealPath.swift` holds the rules (`unsealed`, `short`). `IPASigner.swift` uses them when it seals.
- `Zip.swift` shortens the names, dropping `.` and empty parts.
- Leaving only the `_CodeSignature` extras out of the seal gave 0xe8008001, so everything in a bundle root's
  `_CodeSignature` is left out of the app. `CodeResources` and `_MASReceipt` stay in the app, unsealed.
- After the fix, every variant that gave 0xe8008017 installs, and so does one with all of them together.

## Tests

`test_sign.py` `test_odd_names_sealed` models the phone's scan, both ways, for each bundle. Before the fix it showed
19+ differences. It passes now. `test_swift_signed_ipas_sealed`
runs the same check on every IPA the Swift tests sign (name, icon, tweaks, group fix, arm64e, big binaries): data
changed after it was hashed is not a cause.

## Web signing

Native zsign on the same IPAs (the rig) fails with 0xe8008017 for the leftovers, `foo.DS_Store`, the NFC/NFD pair and
the composed executable name. The `./`, `//` and combining-first names do not fail there: those installs stop at
another error, about the test's entitlements, not the seal. Follow-up: B434.

## Not verified

- Which of these Pocket's IPA has. Leftovers at the bundle root look likeliest, but that is a guess. A retry of Pocket
  with this build settles it. If it still fails, the IPA is needed.
- `codesign --verify` on the MBA (ssh timed out).
- The WebAssembly build of zsign (native zsign was used).
- The last edits were not reinstalled on the phone: the `_CodeSignature` drop narrowed to bundle roots (a plain folder's
  installed before as it is), and a name ending in `/.` taken as a folder. `native/test_sign.py` covers the drop.
- `./` or `//` inside CFBundleExecutable itself, and bundle folders whose own name starts with a combining mark.
