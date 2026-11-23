# B354: My IPAs' signed copy keeps its App ID

## What I did

- `native/sign/Library.swift`: `IPALibrary.Signed` gets `appID` (optional, so copies kept before it still decode),
  filled from the signer's `app.appID` in `sign` and `keepSigned`, and handed on by `Signed.app`.
- `native/Sources/MyIPAs.swift`:
  - `install` puts `s.appID` in the `SignedRecord`, so the next Re-sign/update reads the App ID from the record
    (`Sideload.installedAppID`) instead of asking installd over the pairing, as SignAhead's record does.
  - `signIfNeeded`: a fitting signed copy is used only when the installed app's App ID
    (`Sideload.installedAppID(s.bundleID)`) is unknown or equals the copy's. Otherwise (a copy signed under another
    App ID, or one from before copies kept it, while the app is installed) it is dropped and signed again, where the
    signer keeps the installed App ID. That clears copies made before B340 that would fail with installd error 15.
- `native/test_my_ipas_appid.py`: source checks for all of the above (the shell doesn't run off the phone).

Decision: a copy with no `appID` is treated as different from a known installed App ID, so such copies are signed
once more for an installed app. Costs one sign; avoids installing a copy that may have the wrong App ID. For an app
that isn't installed, or whose App ID can't be found, the copy is used as before. `installedAppID` reads the record
first, so it only asks installd for an installed app with no record, and only when a fitting copy exists.

## Not verified

- On a phone: the install of a kept copy, the record's `appID`, and the re-sign of an old copy. No device check in
  this task; the native builds in `tools/check.sh` compile the change, the Python test checks the source.
