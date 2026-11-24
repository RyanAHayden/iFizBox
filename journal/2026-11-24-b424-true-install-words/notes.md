# B424: say only what is true before iOS installs

## What I did
- The shell used to send phase "installing" 0 before iOS had the install link, so every step before the link (the
  upload of iFizBox's own IPA to the Signing Server, and the handoff of the link) said "Installing". Now it sends two
  earlier phases instead: "uploading" (iFizBox's own IPA to the Signing Server, hostAndOpen) and "handoff" (the link is
  going to iOS). "installing" is now only iOS's real progress (signing.progress).
- The stall timer (callWithStall in web/app/core/signing.js) stops on "uploading" and "handoff", as it did on
  "installing".
- Words changed in the page, the HUD, the run rows and run lines, the retry logs, the website's end line, the
  self-update text, the jailbreak helper's row, the install server's log, and the My IPAs and Re-sign All paths
  (see the table below). New labels: "Uploading" and "Handing to iOS" (web/app/core/signing.js, phaseLabel).
- Files: native/Sources/Sideload.swift (hostAndOpen takes a phase callback), SignAhead.swift, MyIPAs.swift,
  SignBridge.swift (comment), InstallServer.swift and native/test_install_server.py (log line);
  web/app/core/signing.js, apprun.js, installroute.js, signing/library.js, queue.js, route.js, selfupdate.js, watch.js;
  the tests beside them.

## Words table, old -> new
| Moment | Old | New |
|---|---|---|
| HUD at the handoff (Signing Server route, before the link) | Installing | Handing to iOS |
| Re-sign All step at the handoff | Installing X (i of n) | Handing X to iOS (i of n) |
| iFizBox's own update upload (hostAndOpen) | Installing | Uploading |
| HUD once the install link is open | Installing | Waiting for iOS |
| My IPAs, signed copy starts | Installing | Preparing |
| My IPAs, before the install call (Signing Server) | Installing | Handing to iOS |
| My IPAs, before the install call (This iPhone route) | Installing | Connecting to this iPhone |
| Run row, Signing Server route, before the prompt | Tap Install on the iOS prompt | Handing to iOS (Uploading while the IPA uploads) |
| Run line, one app before the prompt | Installing A (1 of 2) | Handing A to iOS (1 of 2); Uploading A (1 of 4) while uploading |
| Console log, retry with the Signing Server | Installing X through the Signing Server | Trying X through the Signing Server |
| Console log, retry with its own bundle ID | Installing X with its own bundle ID | Trying X again with its own bundle ID |
| Website end, no status from the Worker | Installing | Uploaded. Tap Install if iOS asks. |
| Self-update, iOS asked | iOS is preparing the new NAME | iOS asked for the new NAME |
| Self-update, install started | iOS is installing the new NAME | iOS has started downloading the new NAME |
| Jailbreak helper row and run line at "asking" (Installing or Removing) | Installing / Removing | Preparing |
| Install server log, bytes | iOS has N of M bytes | N of M bytes sent to iOS |
| HUD label for the new phases | (none; "installing" 0 said Installing) | uploading: Uploading; handoff: Handing to iOS |

Behaviour, not words: tapping an install row no longer asks again until the prompt is up (apprun.js reprompt returns
false while the link is not with iOS yet, so a second tap does not send a second request).

## Looked at and left, with why
- native/helper/ipa.c: "Installing (AppSync Unified)" is sent as installd is called, and installd's percent follows,
  so it is true when shown.
- web/app/websign-gate.js texts: they describe routes and confirm alerts, not a moment of a run.
- web/app/ipa-install.js: passes the helper's words on; nothing of its own to change.
- Notifications: "Updated to X" is shown once the new version is on disk; "Update Didn't Start" is true when shown.
- Live Activity: none exists in the app.
- Manage's bulk label verb ("Re-signing" / "Installing" name (1 of 3)): it names the whole job, not the moment, so it
  stays.
- web/app/screens/apprun.js needed no change (it gets its words from core/apprun.js).

## Failed / learned
- The tests that assumed a prompt right at state "asking" had to send progress("asking") first, as openPrepared does
  in the app. Without it the row never reaches the prompt state.

## Not verified
- Nothing was run on a phone or on screen. The wording is covered by the JS tests; the native shell compiles only in
  the gate's build.
- The timing of "uploading" and "handoff" on a real self-update was not observed.
- No upload percentage is shown; "Uploading" has none.
