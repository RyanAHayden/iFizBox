# F409: Fix button

## What I did
- core/installroute.js: a FIX const; failureStatus gives a route failure the action "fix" and the Fix label.
- askFix, takeFix and tellFix deliver Fix from the install alert and the run's Log to Installation & Signing.
- screens/installroute.js: check() takes {fix}; a Fix tapped while a check runs joins that check. Pass: green. Turned down: Pairing opens. Otherwise an alert with the plain reason.
- signing/queue.js: a run keeps every route failure, not just pairing ones, so the status cell shows it.
- turnedDown treats bad_pairing (an unreadable kept pairing) as turned down, so Fix doesn't dead-end.
- The run closes when Fix opens Settings, as before.
- runFix doesn't use openRoute: that remembers the page left, and offerInstall went back to it under the alert (seen in the Chromium run).
- Chromium, sideload fake bridge (f372's capture.mjs): shots/fix.jpg: the run's Log, Fix checking, the reason, the failed cell, green after a second Fix.
- Docs updated: docs/settings.md, docs/sideload.md, GLOSSARY.md (Route Failure), release-notes/F409.md.
- Existing tests under web/app/core and web/app/install-server-fallback-b375.test.js were touched in the same change.

## Not verified
- The real connect on an iPhone (VPN on, and the phone refusing a pairing) was not run. This is a web-only change, and AGENTS.md asks for a phone only when Chromium can't check. The failures were simulated with the fake bridge.
