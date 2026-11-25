# F424: "Close <App> to finish installing" after 15 s of silence

## What I did

- Code: `web/app/core/apprun.js` (CLOSE_AFTER 15 s from the copy's 100%, closeText, createAppRun's `replacing`) and
  `web/app/screens/apprun.js` (`replacing`). `replacing` uses `apps.isInstalled`'s true or false when it answers; with no
  answer (iOS 27), it uses the re-sign, the job's installed version, or Installed's record of the bundle ID it installs as.
- The words are on the row and the run line. They end at installd's first percentage, or when the copy starts again.
  They never show for iFizBox's own IPA.
- With several apps, installd works one at a time, so another row's percentage or end restarts the silence of the rows
  still waiting.
- Docs: one sentence in `docs/sideload.md` (the This iPhone bullet). Release note `release-notes/F424.md` reworded to
  say the row shows it.
- Tests: `web/app/screens/apprun-stall.test.js` (8).

## Checks

- Chromium (`runAppRun` with fake lanes on the site, 393x700): the three states looked right (copied, close, Installing 20%).
- iPhone 15 Pro, iOS 27.0.1 (Chromium cannot do installd's silence). A temporary build with `HerePackage.developer`
  returning false, so installs were plain. R102 test app with 30 MB of padding.
  - Fresh install 1.0: copied at 2.0 s, Installing 20% at 2.4 s, never the words.
  - Update to 2.0 with R102Test open in the background, playing audio: copied at 1.9 s. I opened R102Test in front for
    10 s. On return the row and run line said the words (22.7 s page time; the page was suspended in the background,
    so its timer fired on return). The desktop ended the app at about 27 s: Installing 90% at 27.1, Installed at 27.3.
- Clean up: test app, its records and IPAs removed, the branch's normal build reinstalled, lock released.
- The row's words were read through Web Inspector (the shots show the Log); the run line is in the shots. What
  `apps.isInstalled` answered was not logged; iOS 27 gives none (B229), so it was presumably Installed's record.

## Not verified

- A natural Developer-package refusal followed by the plain retry stalling. None came up; the temporary build stood in.
- Several apps stalling at once on the phone (node tests only).
- iOS before 27.
- An app installed outside iFizBox with no record on iOS 27 gets no words, since nothing can tell it is there.

## Review fixes
Words already shown go back when another row's percentage comes; stopping a row that never reached installd is no news;
the words come before Airplane Mode's on the run line; the job's installed version counts only when the app installs
under that same bundle ID. Made after the phone check, covered by node tests (9) only.
