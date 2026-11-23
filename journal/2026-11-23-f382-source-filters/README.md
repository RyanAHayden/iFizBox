# F382: Source Filters

Sources > Manage gets a Filters page. Its switches leave kinds of packages out of every list: old packages,
packages with an unknown iOS, paid packages, older copies, and in the sideload build (Lite) tweaks that can't go
into an app. The switches can be set for All Sources, then each source can keep the same settings or set its own.

## What was done

- `web/app/core/sourcefilters.js` (new, pure): the switches are Works on My Phone, Hide Old Packages, Hide Unknown,
  App Tweaks Only (sideload build only), Hide Paid and Newest Copy Only (All Sources only). All Sources sets the
  defaults. A source follows All Sources unless one of its switches was changed. Hide Unknown is on by default for
  the old sources (BigBoss, ModMyi, ZodTTD), matched on the source key's URL, unless it is changed there.
  The rules:
  - Old: the package's lowest stated iOS is 10 or earlier. An AltStore app is never old, because its
    minOSVersion is the oldest iOS it runs on.
  - Unknown: the package states nothing about iOS.
  - App tweak: an `iphoneos-arm64` build, or it states a firmware of 15 or later.
- `web/app/core/settings.js`: `settings.sourceFilters` is stored as `ifizbox.sourceFilters`, and only the switches
  that were changed are written. All Sources' Works on My Phone is the existing `worksOnMyPhone` setting.
- `web/app/core/catalog.js`: `setFilters(stored, {lite})`. Each row carries `_old`, `_unk` and `_app` flags, worked
  out at load. Filtered rows leave the lists, sections, Search, author and Browse, the same way hidden sections do.
  All Sources is merged from the rows the filters keep. A source's own Works on My Phone overrides the global one.
  Newest Copy Only drops a package from a source's own list when another source has it newer (equal versions both
  stay). `package()` and `upgrades()` still see every package.
- `web/app/catalog.js`: the filters go out with the next question. No question is answered until the device has been
  sent (4 s cap).
- `web/app/device.js`: sends the filters. In the app, the first device send waits for `app.info` to answer (2.5 s
  cap), because the iOS 26+ web view's user agent says 18.6.
- `web/app/screens/manage.js`: Manage > Filters (`#/sources/manage/filters`) lists All Sources (with the count of
  switches On), then each source as Same or Custom. Each page has its switches, with one footer per group. A page that
  has changed says "Same as All Sources" (All Sources says "Reset"). Each Filters page keeps one settings listener:
  a page drawn again replaces the old one, so going back and forth does not pile up redraws. A source's switches
  change in place, and its Same as All Sources row slides in and out with `nav/slide.js` `slideChange`, rather than
  the whole page being redrawn. The list redraws on any filter change while a Filters page is in the address. This
  fixes the bug seen in the concept screen, where the list still said Same after going back.
- `web/app/screens/sources.js`: a Tweak Source's badge counts what the filters keep. A Tweak Source left with none
  says "No app tweaks: this is a jailbreak source" when App Tweaks Only is on for it. If another switch emptied it, it
  says "Filters hide everything here". Either line replaces its URL. Those lines only appear once the source's
  packages are in the catalog, and they never start a load.
- `web/app/sources.css`: `.filters-source` gives the source icons on the Filters rows their own size.
- `web/app/core/sourcefilters.test.js` (new): covers old firmware, unknown on the old sources, rootful-only tweaks
  dropped in Lite, the newest copy, and a source's own Works on My Phone.
- `web/app/module-graph.test.js`: the module limit goes from 117 to 118 for the new module.
- `journal/2026-11-23-f382-source-filters/`: this file, `capture.mjs` (the copy of the B129 script with a new `tap`
  step, which sends CDP mouse events at the centre of an element), `jb.json` and `lite.json` (the scripts),
  `jailbreak-filters.png` and `lite-filters.png`.
- `release-notes/F382.md`: one sentence for the user.

## How it was checked

- `node --test web/` passes, 3314 tests.
- Chromium, headless with the fake bridge, jailbreak build (`jb.json`, `--native <phone dir>`). The phone dir is a
  fake one that lists Havoc, BigBoss and Chariz. The shots are Filters, All Sources, BigBoss after Hide Unknown is
  switched off, and the list after going back, where BigBoss reads Custom. The script also taps Same as All Sources
  (stored choice cleared, row gone, Hide Unknown back on), then switches Hide Unknown off again, so the list after
  going back reads BigBoss as Custom. The banner is removed in the script, since it covered the rows and took the
  first taps.
- Chromium, sideload build (`lite.json`, `--mode sideload`). BigBoss added as a Tweak Source keeps 111 of 4,356
  tweaks. BigBoss does have a small `iphoneos-arm64` index, so it is not empty. A local flat repo served at
  `127.0.0.1:8732`, with two `iphoneos-arm` tweaks (firmware 12 and 13 or later), shows 0 and the "No app tweaks"
  line. `lite.json` needs that local repo to be running.

## What failed along the way

- The update banner covered rows and swallowed the first taps. The scripts remove `.banner` every 200 ms.
- Source icons drew at full size until the rows got their own icon CSS (`.filters-source` in `sources.css`).
- The Tweak Source count was overwritten by the refresh's own count in `paintRow`. The filtered count is now kept in
  `li.dataset.shownCount`, and the note waits for `catalog.onLoaded`.

## Not verified

- A real phone. Chromium covers this web change, as AGENTS.md allows, but nothing was run on the iPhone 7 or the
  iPhone 15 Pro.
- The app.info wait on a real iOS 26+ device.
- The "No app tweaks" line with a real all-rootful public repo. ZodTTD and ModMyi no longer answer.
- The subtitle is cut off on a narrow row next to the trust pill.
- Newest Copy Only has no switch on a source's own page, which is All Sources only, as the brief said.
- A source whose newest copy is old-filtered while an older copy elsewhere isn't. All Sources shows the older copy. This is by design, and it has not been tested on real data.

### Kept on purpose

- The 4 s (catalog) and 2.5 s (app.info) waits are caps, so a dead bridge never leaves lists loading for ever. After
  a cap, rows may be judged for the user agent's iOS until app.info answers.
- The Reset row on All Sources comes from the approved concept.
- The Tweak Source badge shows the filtered count, so it agrees with the empty note.
- A package page opened by a direct link still opens a filtered package, like hidden sections do.
- The Sources tab's badge and note refresh when the list is drawn or a load lands, not the moment a filter changes
  on another tab.

## Spec review

- Hide Old Packages uses only the stated minimum iOS (10 or earlier). The "highest below 11" rule is gone from the
  rule text.
- The old sources are BigBoss, ModMyi and ZodTTD.
- A Tweak Source left empty says "No app tweaks: this is a jailbreak source" only when App Tweaks Only is on for it.
  If another switch emptied it, it says "Filters hide everything here".
- The Filters pages keep one settings listener per page. A page drawn again replaces its old listener, so going back
  and forth no longer piles up redraws.
- A source's page changes its switches in place. The Same as All Sources (All Sources: Reset) row slides in and out
  with `nav/slide.js` `slideChange`, instead of the whole page being redrawn. Checked in Chromium: `jb.json` taps Same
  as All Sources (stored choice cleared, row gone, Hide Unknown back on), switches Hide Unknown off again, and on
  return the list shows BigBoss as Custom.
- The banner removal in the scripts runs every 200 ms (see What failed along the way).
- The waits, the Reset row, the badge and the direct-link behaviour are recorded under Kept on purpose.
