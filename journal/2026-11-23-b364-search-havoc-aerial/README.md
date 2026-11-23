# B364: Search doesn't find Havoc's Aerial

User report: searching "aerial" / "Aerial" doesn't find Aerial (jp.uzra.aerial, Havoc, paid, iphoneos-arm64).

## What I checked

- **Havoc's index loads.** https://havoc.app/Packages (3 MB, 3760 stanzas, 1801 iphoneos-arm64 = 377 packages)
  parses; jp.uzra.aerial has 24 versions, newest 5.1 (Depends mobilesubstrate, com.opa334.ccsupport). The
  iPhone 7's own apt list (`havoc.app_._Packages`, read over ssh, no screen) holds the same file.
- **Core search (catalog.js)** with the live index, rootless: "aerial" and "Aerial" both find jp.uzra.aerial 5.1,
  with and without a device set (Works on My Phone). `havoc-paid-check.mjs`: all 213 paid rootless packages Havoc
  lists are found by their own name. Paid handling: nothing hides `cydia::commercial` rows; only the Paid/Free
  filter uses `paid`.
- **Site in Chromium** (worker/node.mjs + `capture.mjs`): Device Not Jailbroken (the site's default) lists apps only,
  so no tweak shows: by design (F37). Device Jailbroken (Rootless): Search "aerial" finds Aerial 5.1
  (`site-jailbroken.png`).
- **Jailbreak app in Chromium** (fake bridge fed by the iPhone 7's apt state): Search "aerial" and "Aerial" find
  Aerial 5.1 (`jailbreak-app.png`).
- **Sideload app in Chromium** (fake bridge, `--mode sideload`): that's where it breaks, and the user's own phone is
  not jailbroken (iOS 27), so this is the report.
  - Without Havoc: Search shows nothing locally; Other Sources (Canister) shows Aerial 2 and Aerial.
  - Havoc added (Sources > Add, 208 injectable tweaks): **No Results, and the Canister rows are gone**
    (`sideload-before.png`).

## Cause

In the sideload build, Tweak Sources' tweaks stayed out of an unfiltered Search (F302 kept them out of All Sources;
B341 only searched them under the App Tweaks / All Tweaks filter). Other Sources (Canister) leaves out results from
sources already added. So adding the source a tweak came from made it drop out of Search altogether.

## Fix

`core/catalog.js` search(): in the sideload build, a search with no Section filter (All) searches All Sources'
apps and the App Tweaks merge together (`appsAndTweaks()`, cached on the two lists; hidden App Tweaks stays out).
The Apps scope and a section filter are as before; a Tweak Source picked in Source already searched its tweaks.
The exact-match "why" now looks the stanza up through `entryOf`, which knows App Tweaks rows (was `entries(key)`,
which would throw for one).

B341's test asserted the old rule (`c.search("lite")` = []); that one line now expects the tweaks. Its words said
"as F302 decided", but F302's text never asks for Search to leave tweaks out; this report says the user expects
Search to find them.

After: Chromium sideload with Havoc added finds Aerial and Aerial 2 (`sideload-after.png`).

## Aerial 2

com.polytweaks.aerial2 is `Architecture: iphoneos-arm` (rootful only), so rootless (jailbreak app, site Rootless)
rightly never lists it; site Rootful finds it (test). In the sideload build it counts as injectable (Tweak Sources
take iphoneos-arm and iphoneos-arm64, Depends only mobilesubstrate), so it shows there, as Canister showed it.

Side note, not changed: in the sideload build Aerial shows as 2.0, the newest version that passes the injectable
check (2.1+ depend on com.opa334.ccsupport), the F302 per-stanza rule.

## Test

`catalog.test.js` "search finds Havoc's paid Aerial in the jailbreak and sideload builds (B364)": the cut of Havoc's
Packages in `fixtures/paid/havoc-Packages` plus Griddy and Novus (paid Havoc tweaks): any case, newest version,
description, paid filter, Works on My Phone, rootful Aerial 2, and the sideload pool (apps + tweaks, Apps scope,
Source, Paid, hidden App Tweaks). `node --test web/app`: 3290 pass.

## Tried that failed

- First site run had the site's default Device (Not Jailbroken), so Search showed No Results: not the bug.
- The default GitHub Tweak Sources answered HTTP 403 in the sideload runs (GitHub API rate limit here), as in B341;
  Havoc itself loaded.

## Spec review

A fresh subagent read the diff and the brief. Nothing to fix. Here is what it raised:
- The fixture is already in the repo (from B268).
- Griddy and Novus in the test are trimmed copies of real Havoc stanzas. `havoc-paid-check.mjs` covers all 213 paid
  packages against the live index; it is a journal tool and not part of the gate, because the live index changes.
- The `appsAndTweaks()` cache depends on `rowsOf(ALL)` and `tweakSorted`. Both are replaced with new arrays when
  rebuilt, never changed in place.
- The `sections-b341.test.js` line had to change for this fix.
- `capture.mjs` is B129's driver, copied unchanged (its `helper.run` ssh path is unused here). The step files'
  shot names map to the PNGs like this:
  - `app-aerial` → `jailbreak-app.png`
  - `lite-aerial` → `sideload-before.png` / `sideload-after.png` (before and after the fix)
  - `search` → `site-jailbroken.png`

Filed B366 (low): the Sources page shows Havoc's count as 1,801 (rootless stanzas) while it lists 377 packages.

## Not verified

- Not tried on a phone: the fix is pure `web/app/core` search logic, checked in Chromium with both fake-bridge builds
  and with node tests (AGENTS.md: phone only when Chromium can't check).
