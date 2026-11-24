# B426: a real push check for the notification extension

The code side is superseded. B425 (c54158f4, in its merge gate; this branch is based on it) builds the group copy its own way: a one-way copy through the profile's group into the extension's own container. So nothing here changed groupfix, its dylib, tests or docs. The shim mirroring B426 first described was not built; B425's notes say why.

B425's phone report (report-first-run.txt) already shows the extension reading the suite keys equal to the app's: 363 + 8 + 1. B426 did not rerun that probe.

## Done
- iPhone 15 Pro, under the lock, 2026-11-24 14:04: Instagram launched and shows the signed-out "Continue" screen.
- Not tapped: it is the owner's personal account, and signing in is theirs to do.
- The screenshot was deleted: it held personal details.
- The phone was needed because Chromium can't show the app's sign-in or a push. Phone lock released afterwards.
- Asked the owner (CONFIRM) to sign in on the 15 Pro and get a real push. The 15 Pro was chosen over the task's "their phone": it already has B425's dylib (per B425's notes), and testing on the owner's own phone risks the sign-in while B425's "stays signed in" is unproven. Installing over it to test staying signed in stays B425's check.

## If the generic text remains
The next step is the extension's log at the time of the push: ifizbox.shared/com.burbn.instagram/extension.log in the profile group.

## Not verified
- A real push's text (needs sign-in and a push).
- Staying signed in (B425).
- Whether pushes reach the 15 Pro's build at all.
- The build on the phone: taken from B425's notes, not re-read.
