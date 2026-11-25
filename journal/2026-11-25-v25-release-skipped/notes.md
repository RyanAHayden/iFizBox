# V25 release: skipped, nothing to release

Latest tag v0.34.0 (native/VERSION 0.34.0). `git diff v0.34.0 main` outside plan/ and journal/ is empty, and release-notes/ holds only its README. A release would only repeat 0.34.0, and tools/publish.sh refuses an existing tag. The brief names CHANGELOG.md and a release workflow; this repo has neither (docs/release.md: no release on tag push in CI; tools/publish.sh does it by hand with the iOS SDK).

**Not verified**: none (no release was cut).
