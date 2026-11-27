# B506: setup command's pairing words before iOS 27

## What I did
- `tools/setup/core/src/lib.rs`, `import_hint`: when the installed app is iFizBox (name equals the brand name), the pairing bundle ID equals the installed app's, and the path is `Documents/pairingFile.plist`, the command prints "Wrote a pairing file to iFizBox. iFizBox picks it up when you open it, so there's nothing to import." For any other app, container or path it still prints the by-hand Import Pairing File steps.
- Why name and container: the website's computer install uploads iFizBox itself under a free-signed bundle ID that varies, so the ID cannot be matched. The name and the container path are what the command can check.
- `tools/setup/core/src/tests.rs`: two new tests, one for each branch of the condition.
- `python3 tools/setup/test_setup.py` passed: 14 tests run, 1 of them skipped (it includes the core's `cargo test`). Nothing failed along the way.
- `docs/sideload.md`: the Free Apple ID section and the computer-setup command bullet now describe the new words instead of calling the hand-pick wording a planned follow-up; "Not verified" says which words were checked how.
- `release-notes/B506.md`: one sentence for users.

## Not verified
- That the name the website sends for its computer install is exactly the brand name was checked from source only (`native/Info.plist` CFBundleDisplayName is `$(BRAND_NAME)`, which `web/app/core/websign.js` reads), not from a live code.
- Not run on a phone before iOS 27. No such sideload test phone is part of this task, and Chromium cannot show a CLI's run.
- The new words reach people only once the setup command is republished (`tools/setup/release.sh`). That was not done here. The `setup` release still writes the file on every iOS until then.
- If the command is published while the website still serves an app release too old to take the file at launch, the words would be wrong. The app release should go out first, or together with the command.
