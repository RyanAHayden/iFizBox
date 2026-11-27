# B502a1c1: Open on "Sign In Needed" reaches the Free Apple ID group (interim)

**Task:** On the iPhone 15 Pro, check that Open on the "Sign In Needed" alert goes to the Free Apple ID group.

**Status:** Interim. Nothing has run on the phone yet. Its UI lock was held by F465b, then T89.

**Done so far:**
- Started a sideload IPA build of this branch with `native/build.sh ipa`, with SWIFT_TOOLCHAIN and IOS_SDK from `~/.local/share`. Its result is not checked yet.
- Built two tiny test apps in the session scratchpad (C, calls UIApplicationMain; bundle IDs `com.ryha.b502a1c1.one` and `com.ryha.b502a1c1.two`). The build needs clang with `-fuse-ld=lld --ld-path=<rustup ld64.lld>`.

**Plan on the phone:**
- Keep the certificate with `signing.export`, then `signing.remove`.
- Sign in with the spare free Apple ID. Relaunch, so there is no session.
- Queue app one, then app two. App one installs under the held App ID. App two gets the Sign In Needed alert. No new App IDs are used up.
- Tap Open on the alert.
- Restore the certificate, then remove the test apps.

## Not verified

Nothing below has been checked on a device. The phone was busy, so:
- The build of this branch has not been confirmed to produce a working IPA.
- The test apps have not been built into a valid IPA or signed.
- The certificate has not been exported, removed, or restored.
- The free Apple ID sign-in, the queue, and the Sign In Needed alert have not been seen on the phone.
- Open on the alert has not been tapped, so it is not known whether it reaches the Free Apple ID group.
