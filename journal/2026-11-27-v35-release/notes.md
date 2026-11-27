# V35: release 1.0.6

## What I did
- Patch bump 1.0.5 -> 1.0.6 in native/VERSION, as in earlier releases. The 8 waiting release notes were merged into 6 bullets (format checked by publish.sh).
- The task named CHANGELOG.md and a release workflow; this repo has neither. The release is tools/publish.sh (docs/release.md), and the notes come from release-notes/*.md.
- Dry run, then tools/publish.sh 1.0.6 --notes FILE in a scratch clone of main (SWIFT_TOOLCHAIN/IOS_SDK from ~/.local/share), since publish.sh requires main. The scratch clone was deleted afterwards.
- The release commits (2f000d19 Version 1.0.6, c5025c70 AltStore source) went to origin/main from that clone; this branch holds only the journal.
- Tag v1.0.6, site deployed from the tag, verify-live "1.0.6 is up". gh release view shows it (not draft, 7 assets). https://github.com/RyanAHayden/iFizBox/releases/tag/v1.0.6
- gh run list shows no runs (no CI workflow).
- This deploy also puts the relay and install-count Worker changes on ifizbox.com. That matters for R108, which waits for a release.

## Not verified
- No install or upgrade to 1.0.6 on a phone.
- The new Worker behaviour on the deployed site (apple relay, /installs) was not exercised; only /repo/ via verify-live.
