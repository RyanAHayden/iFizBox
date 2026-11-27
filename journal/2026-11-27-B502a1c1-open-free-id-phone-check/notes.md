# B502a1c1: Open on "Sign In Needed" reaches the Free Apple ID group

**Task:** Check on the iPhone 15 Pro that Open on the "Sign In Needed" alert reaches the Free Apple ID group. Chromium cannot do this, because it needs real signing and installing. Test used the Lite build of this branch.

**Method:**
- `signing.export`, then `signing.remove`.
- Signed in with the spare free Apple ID (2FA Allow and code entered on the phone itself).
- Certificate Limit: revoked the old "iFizBox Website" certificate and left iloader's.
- Reloaded the page to drop the session.
- Test apps `com.ryha.b502a1c1.one` and `.two` put in Documents with afcclient.
- Queued with `queueLibraryInstall` over Web Inspector; Confirm tapped on screen.
- Test app build needs `clang -fuse-ld=lld --ld-path=<rustup ld64.lld> -Wl,-adhoc_codesign`.

**Result: PASS.** Open closed the run's page, opened Certificate (from a fresh page, so at the top), and slid to the Free Apple ID group at the bottom of the page. "Use a Free Apple ID" there leads to Sign In Again, as the alert says. No code change.

**Found (filed as B512):** queued together, one app failed and two installed, with no alert.
- The first row failed "iOS refused to install it" (IXErrorDomain 32, Coordinator superseded).
- The second installed as `com.ryha.ifizbox.<TEAM>`.
- Inferred, not proven: the first was signed under the same App ID ("Coordinator superseded").
- Queuing one app again alone showed the Sign In Needed alert, which is how Open was checked.

**Phone restored:**
- Original certificate back (same serial).
- `freeid` localStorage keys removed.
- Test app uninstalled and its record forgotten.
- Test IPAs deleted.
- Queue empty after reload.
- The phone keeps this branch's build.
- The spare Apple ID has a new "iFizBox Website" certificate.

## Not verified

- Open pressed while a run is still going.
- The non-merged Signing page layout on a phone.
- The slide animation itself (only the end position was seen, in a screenshot).
- The cause of the queue bug (B512).
