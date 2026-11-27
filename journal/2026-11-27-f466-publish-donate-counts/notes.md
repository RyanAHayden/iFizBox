# F466 Publish refreshes the Donate counts

## What I did
- `tools/publish.sh` runs `python3 tools/dev_stats.py` (10 min limit) after the Tweak Index step and before the version
  commit. It writes `web/app/core/devstats.js`, which goes into the "Version X.Y.Z" commit. A failed count prints a
  note and keeps the committed file; the release goes on. A dry run doesn't run it. Header comment updated.
- `docs/release.md`: a short paragraph after the Tweak Index section says the same.
- `tools/test_publish_notes.py`: covers a failed count (release goes on, committed file kept), a successful count
  (devstats.js in the version commit), and a dry run (count not run).
- Tests: `python3 tools/test_publish_notes.py` passed, 14 tests.

## Notes
- The commits count is taken before the version commit, so it excludes that commit.

## Failed attempts
- None.

## Not verified
- A real release run with the real `dev_stats.py` inside `publish.sh`. That would publish; the test uses a stand-in
  script.
