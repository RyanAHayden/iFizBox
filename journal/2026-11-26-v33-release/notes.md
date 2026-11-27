# V33: release 1.0.5

## What I did
- Patch bump 1.0.4 -> 1.0.5 for the 8 waiting release notes, merged into 5 bullets (checked with tools/publish_notes.py).
- Dry run, then tools/publish.sh 1.0.5 --notes FILE in a scratch clone of main (SWIFT_TOOLCHAIN/IOS_SDK from ~/.local/share).
- Tag v1.0.5, site deployed, verify-live "1.0.5 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v1.0.5
- The release commits went to main from the scratch clone (publish.sh requires main); this branch holds only the journal.

## Not verified
- No install of 1.0.5 on a phone.
