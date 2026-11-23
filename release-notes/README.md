# Release notes, as we go

A task that changes something users see adds one file here, `release-notes/<task ID>.md`, holding one plain
sentence: what a user notices, or what they must do. No task IDs, file or API names, or internal terms. Changes
users never see (tests, tooling, docs, refactors) add nothing.

One file per task, so merges never clash. The release reads only these files, writes the notes from them and
deletes them in its version commit (this README stays). Style and an example: `docs/release.md`, "Release notes".
