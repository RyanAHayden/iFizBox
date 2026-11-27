# T88 Skip stale builds in TagSource

`tools/test_deploy.py` TagSource failed in `release.sh` when `native/build` held a stale `.deb` from an earlier task.

Why: a slot without SWIFT_TOOLCHAIN/IOS_SDK skips the native build, so the gate reused whatever `.deb` was already there. On B505 the `.deb` was 1.0.3-6016 while `native/VERSION` said 1.0.7.

What changed:

- `unpublishable(build, version)` in `tools/test_deploy.py` returns why a build can't be published: the `.ipa` or `.deb` is missing or unreadable, or its version differs from `native/VERSION`. It returns nothing when the build matches.
- TagSource skips with that text when the build can't be published, and the gate lists the skip with the others.
- The test now publishes the repo's `native/VERSION`. Before, it overwrote that file with the `.ipa`'s version, so a stale `.ipa` alone went unnoticed.
- New `Unpublishable` cases: matching build, stale `.deb`, stale `.ipa`, missing or broken file.

Checked:

- `python3 -m unittest -v tools.test_deploy`: 13 pass.
- TagSource ran, not skipped, against a current 1.0.7 build.
- `tools/gate_unittest.py tools` passed.
- Nothing tried failed.

## Not verified

- A real gate run in a slot with a stale `native/build` and no toolchain. This slot has a current build, so the stale cases are covered only by unit tests that use made-up `.ipa` and `.deb` files.
