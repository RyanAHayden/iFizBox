# Release notes check (F439b)

## Done

- `tools/publish_notes.py FILE` checks a notes file: 1 to 6 `- ` bullets, at most 100 characters after `- `, each
  ending with a full stop, no headings or summary block, no links or download text. A bullet that repeats another
  is refused when 80% of the shorter one's words appear in the other (articles and "now" ignored). That catches
  0.34.0's summary-then-bullet paraphrase. A bare domain such as a site name is not a link.
- `tools/publish.sh` runs the check on `--notes FILE` right after the pull, before the auth checks and the version
  commit. A dry run checks too, and the failing line is named.
- `docs/release.md` ("Release notes", "Cutting one", "What a release is", Options) gives the format, the release
  session's simplify step and the `--notes` rules. `release-notes/README.md` and `AGENTS.md` point to it.
- The footer in default notes is removed by F439a, not here.

## Not verified

- No real publish run: this task doesn't release.
- `publish.sh` was run against a temporary repo with stub release and deploy scripts.
- The check can't judge topic, importance or merging. The release session does that.
