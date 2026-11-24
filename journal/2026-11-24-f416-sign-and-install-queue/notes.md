# F416: Sign and Install (Manage) goes through the IPA queue

- `signMany` (web/app/screens/myipas.js), sideload app with the Signing Server reachable: `queueMany` asks every Replace App? (B80, `queueLibraryInstall`) first, then queues all the jobs and Confirm opens once. The app run does the rest, up to HERE_PARALLEL at once on This iPhone. Asks come first so Confirm is never under an ask or short of a pick.
- Offline (Signing Server check fails), and the website, keep the old loop: in turn, stopping at the first that doesn't install. An IPA page's Install falls back the same way.
- Picks with one bundle ID: the queue holds one job per ID, so the last pick wins. The old loop installed both, the second over the first, so the phone ends up the same.
- The action sheet before it (F224) stays, so Confirm is a second tap.
- Stop at the first failure: no record says a person chose it. The F224 brief does not mention it (its agent added it), and F234 (user) and F240 moved the other queues to "a failure doesn't stop the rest". The app run has no stop-at-first-failure, and with three installs overlapping it would only hold back rows not started. Built as the app run does it; the task says a person decides, so it was asked (`run ask`). Answer (2026-11-24): Carry on, as built.
- Failed: the first test of the overlap never ended (its install stub stayed busy); rewritten with installs the test ends by hand.

## Not verified

- A device run with 2+ rows copying at once: R98 (after F416) does that on the iPhone 15 Pro.
- The screens in Chromium: Confirm and the run are the existing ones, reached by `queueApp`; only the tests checked the new way in.
