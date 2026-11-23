# D27 Keep release notes as we go

## What I did

- `release-notes/README.md`: the rule (one file per user-visible task, one plain sentence).
- `AGENTS.md`: one rule bullet pointing at it.
- `docs/release.md`: new "Release notes" section (the style: 4 summary lines under ~60 chars, at most 6 one-sentence
  bullets, small fixes grouped as "Smaller fixes", internal changes left out; one short example), and the
  `--notes` default updated.
- `tools/release.sh`: without `--notes`, the notes are one bullet per `release-notes/*.md` (README.md left out,
  newlines in a file joined), then the usual footer. With no such files the notes are just "Smaller fixes and
  improvements." (the commit subjects are no longer used: the release "reads only release-notes/*.md").
  `IFIZBOX_RELEASE_NOTES_DIR` reads another folder (publish.sh's copy, and the tests).
- `tools/publish.sh`: copies the committed notes files (`git ls-files`; an untracked one is left alone) to its
  temp dir before the version commit, deletes them with `git rm` in the "Version X.Y.Z" commit (which names its
  paths), and hands the copy to release.sh, which
  builds in a worktree of that commit where the files are already gone. Deletion happens even with `--notes`,
  since the person or agent wrote those notes from the files. If native/VERSION was already the version, a commit
  is still made when there are notes to delete.
- `tools/test_release.py`: dry run with two sample files plus a README prints notes made from the two; and the
  fallback to commit subjects with an empty folder.

Decision: the script itself can't write the 4 summary lines (that needs judgment); the release agent writes the
notes file from release-notes/*.md per docs/release.md and passes `--notes`. The script's default is the plain
bullet list.

Spec review (fresh subagent) found: commit-subject fallback broke "reads only", untracked notes would be
deleted, the version commit committed everything staged. All three fixed. Kept: the default is a plain bullet
list (no summary lines/cap/grouping): that needs judgment, so the release agent writes it per docs/release.md and
passes `--notes`.

## Not verified

- `tools/publish.sh` end to end (even `--dry-run`): it needs to run on main in the main checkout with
  SWIFT_TOOLCHAIN/IOS_SDK, and a real run pushes and publishes. Checked only with `bash -n` and by reading; the
  release.sh side it calls is covered by the dry-run tests.
