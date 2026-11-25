# B458b: Needs Re-sign counts an app as older only by a marked change that reaches it

## What changed

- `web/app/core/signing.js`: `olderSigner` lists a record when a signer version later than its stamp reaches it. A
  version with `reach.groupFix` skips apps without the fix; a version whose reach is unknown counts as listing. It also
  lists a record that carries the fix when its group fix revision is below the current one. A hash change alone lists
  nothing. Old records without a revision count as revision 1 for hash 496d0525dc08812d and 0 for any other hash. No
  stamp = listed. With no current revision (no bundled dylib) an app is still never listed by the dylib, as before: a
  re-sign could not bring one. Expiry rows are unchanged.
- `web/app/core/websign.js`: `WEB_REACHES` (the web copy of the `reaches` table), `WEB_SIGNER_VERSION` (its newest key,
  still 3), `WEB_GROUPFIX_REVISION` (1). A test holds the revision equal to `SignerStamp.groupFixRevision`, since both
  signers inject the same dylib. `webSignerStamp` adds `groupFixRevision`. `webSignerNow()` is the current stamp with
  its reach.
- `web/app/core/installed.js`: `signatureOf` keeps `groupFixRevision`. `siteSignerNow` no longer downloads the dylib to
  hash it, as nothing compares the hash any more; a failed download used to hide listed apps.
- Tests: `web/app/core/signing.test.js`, "B458: an app is older only by a marked change that reaches it", covers each
  case, including a re-signed app leaving the list. `web/app/core/f342-site-signature.test.js` checks the website
  records the same.

## Decisions

- A hash change alone never asks for a re-sign: only a version that reaches the app, or a revision raised by hand, does.
- Unknown reach counts as listing, so a record from a signer without a reach table is never hidden by mistake.

- Spec review fixes: a current stamp with a dylib but no revision (a shell from before it) counts as revision 1, so
  records with another hash stay listed; an app that got the dylib keeps its revision even when the hash can't be had
  (`webSignerStamp(hash, got)`, one line in `websign-job.js`).

## Not verified

- The phone. The pure JS logic is covered by the node tests; the native JSON keys are covered by B458a's signer tests.
