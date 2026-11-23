# B391: No tweak downloads to filter lists in Lite

## Why
In the sideload build (Lite), the app downloaded tweak `.deb`s in the background to decide which tweaks a list kept:
`browse.js` `dropRefusedTweaks`, and `tweaks.js` `checkTweakRows`, `checkForApp` and `addableTweakRows`, for each Tweak
Source's list and for Add Tweaks. The lists now decide from the verdicts and the mention rule below, with no tweak
downloads to filter them.

## What I did
- The rule, in one place (`docs/sideload.md`, "Tweaks in sideloaded apps"): the Source Filters first; then a verdict
  (a shipped Tweak Index file, or a check kept on this phone) decides; with no verdict (a free or paid tweak, or a
  source the file doesn't have), a tweak is listed only when its name or description mentions a known app or one of
  the user's apps. A tweak already in an app is always listed. One this phone found to work stays listed while a newer
  version has no verdict. The same rule feeds App Tweaks, Search, Sections, a source's list and count, Add Tweaks and a
  source's featured banners (`catalog.shows`).
- Opening a tweak or Add to App still checks that one `.deb`. Nothing else downloads one.
- Verdicts and the user's apps are read before the first list draws (5 s cap).
- The mention check is `core/tweakfields.js` `hintMatcher(known)`. It lives there and not in `core/tweakindex.js`:
  putting it in `tweakindex.js` broke the module limit for the `app.js` startup closure. The regexes are built once
  per set of apps, not once per tweak.
- Verdicts. A verdict that is taken back is now `null` (not known), not `false`, so the tweak falls back to the
  mention rule. A held tweak (one the user has in an app) overrides a refusing verdict.
- GitHub Tweak Sources (not in the Tweak Index file) follow the mention rule. The defaults YTLite, YTMusicUltimate and
  SCInsta mention their apps in their GitHub descriptions (checked with `gh api`), so they stay listed.
- Add Tweaks lists a guess (unverified) under Made for. The count on the app's page and in the install popup leaves
  guesses out. A paid guess there still needs a source with a seller.
- Newest Copy Only no longer lets a hidden newer copy hide an older listed one.
- Search's Other Sources (Canister, repos not added) are not in this task and are left alone.
- Changed: `web/app/catalog.js`, `web/app/core/catalog.js`, `web/app/core/tweakindex.js`, `web/app/core/tweakfields.js`,
  `web/app/core/featured.js`, `web/app/screens/browse.js`, `web/app/screens/tweaks.js`, `web/app/screens/extras.js`.
  The jailbreak build is unchanged.

## Tests and checks
- `node --test web/app` passes.
- New fixture tests: `core/catalog-systemtweaks.test.js` (a source's kept and dropped rows, Search, the section count)
  and `screens/tweaks-index.test.js` (the index answer and the mention rule). `screens/tweaks-addable.test.js` is
  removed with the code it covered.
- The real Chariz Packages with the shipped `tweak-index.json`: 48 injectable-looking tweaks, 28 with verdicts, and 0
  listed. The Glint-type tweak (no verdict, mentions no app) is gone.
- Chromium, in this folder: B377's `capture.mjs` run with `--mode sideload`, a repo made by `repo.mjs` on
  127.0.0.1:8747, script `lite.json`.
  - `app-tweaks.png`: 6 tweaks in App Tweaks.
  - `source-page.png`: 2 of the 5 banners shown, and the source's count is 6.
  - Search: "glint" gives 0 results, "dislike" gives 2.
  - The repo's request log has no `.deb` request.

## Tried and failed
- Telling `Changes`' listeners about new apps so the badge recounts. The badge recount tests failed because one
  recount superseded another. It is not needed for this, so I dropped it.

## Not verified
- On the iPhone 15. This is a web-only change, and the Chromium check covers it under the phone rule.
- A `.deb` bought from a real seller. The bought case is a kept check in the tests, not a real purchase.
- A newer index file that arrives while a list is open is not redrawn until the list is reopened.
