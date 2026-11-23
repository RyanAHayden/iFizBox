# B337: Use the Signing Server keeps the download, the progress and the Log

## What was wrong
The run's Use the Signing Server (screens/apprun.js `offerServer`) called `run.retry` for each failed row: the row
went back to "waiting", so it downloaded and signed again, its bar dropped to 0, and the new pass emptied the Log.

## What changed
- `core/apprun.js`: `run.installAgain(ids)`: failed rows that still hold their signed IPA (`token`) go back to
  "signed" (no `progress` in the patch, so the bar keeps what it reached) and only the install lane runs them.
  When the run had ended, the new pass starts with `start({ keep: true })` and `onStart(pass, { keep: true })`.
  Such a row (`reinstall`) whose install answers code `gone` (the shell no longer keeps the signed IPA) signs again
  from the start, with a Log line, as B91's Try Again does.
- `screens/apprun.js`: `onStart` skips `clearLog` for a `keep` pass; `offerServer` calls `run.installAgain`, and
  `run.retry` only for a row it couldn't take (no token: none expected, fallbacks come from the install).
- `native/Sources/SignAhead.swift` (outside the brief's file list, needed for the phone): `signing.open` takes the
  kept IPA out of `kept` and This iPhone's `installHere` deletes the file, so a second open on the same token
  answered "gone" and the web side would have signed again anyway. Now, on the This iPhone route, a hard link of
  the kept IPA (`spareLink`, same folder, no copy) is made before the install; on a failure that wasn't a cancel it
  goes back into `kept` under the same token (forgotten after `life`) and the F343 original is not dropped; on
  success the link is removed.
- Tests in `screens/apprun.test.js`: the fallback installs again with the same token and `server: true`, no second
  sign call, the Log keeps its earlier lines with the serverStep line after them, the row's progress doesn't drop;
  and a `gone` answer signs again.

## Not verified
- The native change on a phone (iPhone 15 Pro, This iPhone route failing, then Use the Signing Server): it needs a
  This iPhone failure staged on the device (VPN off / pairing refused) and a Lite build installed; only the gate's
  native build checks that it compiles. The hard link relies on `SignBridge.work` being one filesystem (it is one
  folder), and `linkItem` failing just falls back to the old behaviour (the web side then signs again on `gone`).
- The prepare's own `life` timer can still forget the re-kept IPA up to 30 minutes after signing (not after the
  failure); the row then signs again through the `gone` path.

## Spec review
- Flagged the SignAhead.swift change as outside the file list. Kept: the brief asks that the fallback keep the
  download and install "from the IPA already downloaded/prepared", and without it the shell answers `gone` on the
  phone. Also kept: the `gone` path signs again (otherwise the row would just fail).
- Fixed: a space dropped after `=` in SignAhead.swift (it broke the native build in the first gate run), and the
  progress check now reads the row's progress when the second install starts, not before it.
- Noted: the re-kept IPA stays for `life` after any non-cancel This iPhone failure, even if Use the Signing Server is
  never tapped; `forget` drops it and the original then, as for any IPA that was never opened.
