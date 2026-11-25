# B458a: Needs Re-sign lists only the apps a marked signing change affects

## What changed

- `native/sign/SignerStamp.swift`: `reaches: [Int: Reach]` replaces the literal `version = 3`; `version` is its newest
  key. Versions 1 to 3 all reach every app: version 2 gave apps without the group fix the fix, so it isn't groupFix-only.
  `groupFixRevision` (hand-set, 1 = the dylib of 0.31.0, hash 496d0525dc08812d) goes in a stamp only when the app got
  the fix (`SignerStamp.signed(groupFix:)`); old records and apps without the fix have none. `json` adds
  `groupFixRevision` beside `version` and `groupFix`. `currentJSON` adds `reach: {all: [..], groupFix: [..]}`.
- `native/Sources/Sideload.swift`: `signing.installed` answers `SignerStamp.currentJSON` (one line; outside the task's
  listed files, but it is the only place that answer's signer is made).
- `native/sign/Library.swift`: comment only. `isStale` is unchanged, so My IPAs' saved copy still refuses another
  dylib hash whatever its revision.
- `native/groupfix/build.sh`: notes when to raise the revision (a change installed apps with the fix should get),
  and when not to (logging, a tidy-up, another toolchain).
- `GLOSSARY.md`: entries "Group Fix Revision" and "Reach" (`agent-runner glossary add`).
- Web code is unchanged until B458b.

## Decisions

- Which apps a version reaches lives only in the `reaches` table. The stamp gains one optional key
  (`groupFixRevision`), so records already on phones still decode with it nil.
- With no bundled dylib the current stamp has neither a hash nor a revision.
- The revision is raised by hand, not derived from the dylib hash: a new dylib build alone must not ask every app
  with the fix for a re-sign.

## Tests

- `native/sign/tests/main.swift`, test "B458: group fix revision, reach": the record's JSON and the current JSON
  (revision present, `reach` only in the current one), each version in exactly one reach list, versions 1 to 3 in
  `all`, a saved record keeping its stamp, an old `{version, groupFix}` record decoding with a nil revision, and a
  saved My IPAs copy with another dylib refused and then signed again.
- The B211 group fix check (inside test "B211: group fix") now also checks the revision on an app with the fix and
  none on iFizBox's own.

The Swift signer tests (native.test_sign) pass.

## Not verified

- The phone: nothing on screen changes in this part, only the extra keys in the bridge answer. Not run on the 15 Pro or the 7.
