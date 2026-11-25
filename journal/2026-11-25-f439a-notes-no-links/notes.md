# F439a: release notes without links or footer

Release tooling only. No app code, no release-notes/F439a.md.

## Changes

- tools/release.sh: the default notes (no `--notes`) no longer end with the IPA/.deb footer. Blank release-notes files now also give "Smaller fixes and improvements." A `--notes` file is copied as it is, empty or not; a zero-byte one also gets the plain line.
- tools/altsource.py: `note_text` no longer adds the "Release notes: <url>" line, and lost its unused version argument. Empty notes give "Smaller fixes and improvements."
- docs/release.md: the `--notes` options line no longer describes the footer.

## Left as is

- Old source.json entries stay as published, so they keep their "Release notes:" line. web/app/core/essential.js keeps its filter that drops those lines.

## Tests

- tools/test_release.py and tools/test_altsource.py.

## Not verified

- A real publish (only when a release is cut). Dry runs cover the notes and source.json.
