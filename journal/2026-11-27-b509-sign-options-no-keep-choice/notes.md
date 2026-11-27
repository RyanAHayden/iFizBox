# B509: Sign Options saved with no Keep Bundle ID choice stay no choice

## What I did
- Saving Sign Options without `keepBundleId` (what a free Apple ID's profile sends since B508) stored `keepBundleID`
  as true. `library.list` reported that as a saved choice, and under another profile the IPA kept its bundle ID even
  with Settings' Keep Bundle IDs off.
- `native/sign/SignOptions.swift`: `keepChosen` is false when the page's params lack `keepBundleId`. Signing still
  keeps the ID as before; only the saved record changes.
- `native/sign/Library.swift`, `setOptions`: with no choice, the options file is written with `keepBundleID` absent
  and `keepUnchosen: true`. Absent alone is the pre-F237 way and still means the old thing, so the new field keeps
  the two apart. `options(_:keep:)` applies the global setting, and `library.list` reports `keepBundleId` as null.
  `setOptions` keeps an existing signed copy when only the unchosen switch would differ; `signed(_:keep:)` still
  checks the copy against the setting.
- `native/sign/CertCheck.swift`: new `keepUnchosen` field in `SignedRecord.StoredOptions`, left out of `==`.
  Records and signed copies still always store a concrete value.
- `native/sign/tests/main.swift`: new test "B509: Sign Options saved without a Keep Bundle ID choice follow the
  setting".

## Checks
- `native/test_sign.py` passes with the Swift toolchain (6 tests OK).

## Left as is
- Options already saved with `true` by the earlier behaviour still count as a saved choice. They cannot be told apart
  from a real choice, so they keep their value.

## Not verified
- Not tried on a phone (iPhone 15 Pro).
- The logic is covered by the native sign tests on Linux only.
- The new test was not run against the old code to see it fail.
