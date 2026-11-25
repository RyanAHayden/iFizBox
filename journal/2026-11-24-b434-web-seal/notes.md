# B434: website signing drops and renames what iOS's seal check refuses

## What changed
- New `web/app/websign-seal.js` (`prepareSeal`) and `web/app/websign-seal.test.js`.
- `web/app/websign-job.js` calls `prepareSeal` right after unzip, and again after `putTweaks` when tweak files
  were written.

## Why
- The app's own signer keeps `CodeResources`, `_MASReceipt` and `foo.DS_Store` in the app (unsealed or sealed).
  On the web they are dropped, because zsign decides what is sealed and there is no hook for that without
  rebuilding the wasm.
- `.DS_Store` itself stays in the folder: iOS skips it.

## Rules
- Pairs of names that differ only in NFC/NFD: the first spelling stays, the last one's data is kept (what APFS
  does). Folders merge.
- An executable with a non-ASCII name needs its folders and `Info.plist` to match. Zsign finds the executable by
  the spelling in `Info.plist`, and erases it from the seal by that spelling, so `Info.plist` must change with it.
- `Info.plist` is changed by patching bytes, not by re-serialising. XML: a regex on the string. Binary: a new
  string object is appended and the reference is repointed. Re-serialising would lose real and integer types.
- The first version repointed the shared string object. Binary plists share equal strings, so that also changed
  `CFBundleName`. The test caught it; the patch now gets its own object.
- The bundle's folders are decomposed only when the executable is non-ASCII, as Swift does.

## Tests
- `websign-seal.test.js` runs the real zsign wasm and models iOS's scan the way `native/test_sign.py`
  `seal_problems` does.

## Phone check
One IPA with every case at once (leftovers in the app and a framework, `foo.DS_Store`, NFC/NFD file and folder pairs,
a composed app folder and executable), signed with the WebAssembly zsign in node and the ad hoc wildcard profile,
installed with `pymobiledevice3 apps install`: main refused with 0xe8008017; this branch installs, with an XML and with
a binary Info.plist. The test app was removed after. A first run with the development profile and a framework whose
binary was an executable got past the seal but stopped at 0xe8008015 (the test's own signing, not looked into).

## Not verified
- Safari itself: the tests run in node with the same wasm.
- Executable names outside Latin letters, such as emoji, in a binary `Info.plist`. Zsign reads surrogate pairs
  wrongly, so it can't find that executable. As before.
- A UTF-16 XML Info.plist with a composed executable name: it can't be changed, so it is signed as before.
