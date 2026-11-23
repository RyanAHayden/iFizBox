# B340: My IPAs keeps the installed app's App ID

## What

- `native/Sources/MyIPAs.swift` `signIfNeeded` (behind `library.sign` and `library.install`) now sets
  `signer.installedAppID = { Sideload.installedAppID($0, log: log) }`, as `SignAhead.sign` (B280) and
  `Sideload.signAndOpen` (B138) do. An IPA whose installed copy has another App ID is signed for that one by
  AppIDMatch, or stopped before signing, instead of iOS answering installd error 15.
- The log half was done by B327 for `library.install` only. `library.sign` is a logged run too (core/signing.js
  `SIDELOAD_RUNS`, "Sign …" in Console Logs) but passed no `log:`, so its Keychain:/Group fix: lines and the App ID
  lookup's lines went only to NSLog; it now passes the same `log:` (found by the spec review).
- `native/test_my_ipas_appid.py`: source checks (the shell can't run off the phone), like
  `native/test_sign_ahead_appid.py`. The brief said to test in `native/sign/tests/sideload`, but that binary is built
  from `native/sign/*.swift` only; `MyIPAs.swift` needs UIKit/the bridge and can't compile on Linux. The signer's own
  behaviour with `installedAppID` is already tested in `native/sign/tests/main.swift`.

## Left out

- The signed copy (`IPALibrary.Signed`) has no `appID`, so the install record has none either and the next update
  asks installd again. That needs `native/sign/Library.swift`, outside this task's files: filed as B354.
- A signed copy made before this change with the wrong App ID is still handed out by `library.signed` (it doesn't
  know the App ID); Unsign or a new certificate clears it. Not filed: rare, and B354's appID would let it be checked.

## Not verified

- On a phone: no run on the 15 Pro with an app installed under a wildcard App ID. Needs a real install under another
  profile; the source check and the signer's Linux tests cover the code path.
