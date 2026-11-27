# B504: the setup command writes the pairing file only before iOS 27

## What I did
- Core only: `tools/setup/core/src/lib.rs` and `tests.rs`. Before iOS 27 the command writes the pairing file into the
  app's container and prints where to pick it (Settings > Installation & Signing > This iPhone, Pair This iPhone,
  Import Pairing File, On My iPhone > app). From iOS 27 it writes nothing and says nothing. An unreadable iOS version
  counts as old, so it writes. The computer is still trusted on every iOS.
- `docs/sideload.md`: "The command", "The code", "Pairing after a Computer Install" and "Not verified" now say this.
  The published setup release still writes the file on every iOS until the next one is published.
- No release-notes file. The change reaches people only with a setup release, not an app release, so an app release
  note would claim something the app version doesn't ship.

## Tried and failed
- Nothing failed.

## Checks
- `cargo test` in `tools/setup/core`: 19 passed. New tests: iOS 26.5 writes the file and prints the hint; iOS 27.0 and
  28.1 write nothing and say nothing, while the computer is still trusted.

## Not verified
- No run against a real phone: no pre-27 free-profile setup run, and nothing run on a phone at all.
- The printed in-app path was checked against the web and app source only, not on screen.
- `cli/` was built only as far as `tools/check.sh` runs it.
- The setup release is not published; that needs the person's OK.
