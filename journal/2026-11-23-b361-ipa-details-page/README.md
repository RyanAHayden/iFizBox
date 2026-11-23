# B361: IPA Details Page

An IPA's page in My IPAs (Install IPAs) is now laid out like an app's Details page. Its Add Tweaks row pushes the
Add Tweaks page, which slides in and can be swiped back from, and tapping a tweak there opens its Details page.

## What was done

- `web/app/screens/myipas.js` `renderIpa`: the page uses the app page's header (`storepage.js` `storeHeader`, as
  `altstore.js` `renderApp` does). The stars row is removed, since a local IPA has no ratings. The bundle ID sits in
  the developer slot, with a "Version 1.5 · 39.1 MB" line. The nav title is "Details".
- `web/app/screens/myipas.js` `renderIpa`: in the sideload build, the app page's Add Tweaks group is shown
  (`tweaks.js` `addTweaksGroup` with the `pkgTweaks` tile, footer removed as on the app page). Its row always
  pushes the Add Tweaks page (`browse.js`, route `addtweaks:<bundle id>`).
- `web/app/screens/myipas.js` `pageOf`: routes `ipa:<file>/addtweaks:<id>[/...]` are handed to `browse.js`.
- `web/app/screens/details.js` `ipaRows` (new): the Version group (Version) and the Information group (Works On from
  MinimumOSVersion, Size, Extensions, Bundle ID, File). Source, Category, Version History, CHANGE, reviews and
  screenshots are left out.
- The IPA's own Status, Sign Options, Sign Now, Save Signed IPA and Delete groups are kept.
- `web/app/screens/myipas.js` `syncOnTweakChange` (new): on each hashchange while the IPA page is on the stack, it
  compares the kept tweak names with the last seen. On a change it calls `syncLibraryTweaks`, which re-reads the
  entry first so a newer Sign Options save is not overwritten, then redraws the page through `afterInstall`, so Sign
  Options shows Changed.
- `web/app/screens/tweaks.js` `addTweaksGroup`: the `open` option (used only by My IPAs) is removed. The row always
  pushes the page.
- `openAddTweaks` stays. The app page's Install popup "Add Tweaks…" still opens it.
- The website and jailbreak-app IPA pages get the new header too. They keep their own detail groups
  (`siteIpaSections`, `jailbreakIpaGroups`).
- `web/app/screens/myipas-b361.test.js` (new), a B361 test in `details.test.js`, and routes in `myipas.test.js`.
- `journal/2026-11-23-b361-ipa-details-page/`: this file, `capture.mjs` (from the F382 journal, with `library.list`
  and `library.options` fakes and an edge-swipe touch step), `check.json` (the script), `repo/` (a local flat repo
  whose `tweak-xz.deb` is a symlink to the fixture), and the four PNGs.
- `release-notes/B361.md`: one sentence for the user.

## How it was checked

- `node --test web/app` passes, 3380 tests, 0 failing.
- Chromium, sideload build: `python http.server` serves `repo/` on `127.0.0.1:8761`, and `web/app` is served on
  `127.0.0.1:8762`. Run with `node capture.mjs http://127.0.0.1:8762/ <outdir> check.json --mode sideload`.
  - My IPAs > Delta > Add Tweaks pushes with a slide (22 moving frames), and no sheet appears.
  - An edge swipe back returns to the IPA page (43 frames).
  - ADD, then tapping "Fixture Tweak", opens its Details page under the Add Tweaks route.
  - Two swipes back land on the IPA page, showing "1 Added" and Sign Options "Changed".
  - `library.options` is called once, with the tweak name.

## What failed along the way

- The first Chromium fake stored the tweaks object as the shell's options, so Sign Options stayed "As Is".
  `native/sign/Library.swift` keeps tweaks as names only, so the fake was changed to match. Sign Options then showed
  Changed.

## Not verified

- On a real iPhone (the 15 Pro). `AGENTS.md` does not require it here: the change is in `web/app`, and Chromium covers
  the routing, the slides and the swipe.
- The website and jailbreak IPA pages were not captured. Only their header changed, and unit tests cover it.
