# F414: Set Up This iPhone

## What I did
- Concept K8, option A: the page was read from the concept artifact's embedded modules and diffed against its "before" modules, not copied by hand.
- core/installroute.js: `setupSteps`, `SETUP_FOOTER`, `iphoneStatus` (This iPhone's status cell and action), `fixQuestion` (Not Now / Fix alert for a lost pairing and Couldn't Connect), `installStatus` (Set Up This iPhone / Finish Setting Up cell), `failureStatus` (Pairing Lost, was Pair Again).
- screens/installroute.js `localGroups`: the status group first, then the Set Up group (three steps until set up), Forget Pairing once paired, How It Works.
- docs/settings.md, docs/sideload.md, GLOSSARY.md (Route Failure now says Pairing Lost; new term Set Up Steps), release-notes/F414.md.

## Decisions
- Restore My VPN switch left out (queued F411/F412).
- The concept's default route "iphone" was demo-only, not taken; Install Apps With keeps the user's pick.
- Forget Pairing shows whenever paired, not only once set up as the concept had it: Pairing is no longer linked from the page when paired, so a failing test would have no way out.
- Fix on Pairing Lost keeps F409's route: Pairing checks the pairing once more, then pairs.
- File-pairing wording for older iOS ("Import a pairing file from a computer").
- Steps appear only once `idevice.status` answers, so no step flashes in and out.
- A failing first test: Fix runs the test again.
- No automatic check right after a manual one.

## Chromium check
- F372's capture.mjs with an `idevice.verify` fake, at 402 and 320 pt: `shots/flow.jpg` (the flow), `shots/fix-320.jpg` (the failure alert then Fix).
- Found and fixed: Fix from the alert didn't show Checking….
- The Upgrade banner in the shots is the shell's own, not part of this change.

## Not verified
- Real VPN and pairing on an iPhone: a web-only change, checked with a faked bridge (AGENTS.md).
- Older-iOS file pairing: node tests only.
- Themes and eras: only iOS 6 and iOS 26 were seen.
