# F352 Add Tweaks as a pushed page

Built the approved concept (branch concept/add-tweaks, artifact SVhAEd2eq5dYVA5M37WYWe) without its concept-only
bits (Sample Tweaks source, sample YouTube app, concept-tweaks fixtures, sample.py lines, conceptInfo/CONCEPT_ANY,
conceptAdded, the 'YouTube' name fallback). The concept's app.js back-label commit was B302's, already on main.

## What changed

- `browse.js renderAddTweaks`, route token `addtweaks:<bundle id>` (parseToken, nav: "Add Tweaks", plain list):
  the grey list search bar, the tweaks as Search's package rows (packageList: icon, name, version, description)
  with the price button at the end, grouped Added / Made for <app> / Works in Any App, then More Tweaks.
  A row links to `package:<id>@<its Tweak Source key>` (keyedToken), so the tweak's Details open from its Tweak
  Source; `pageOf` now reads `@key` in the Sources tab too (it only did outside it), because an app's Details is
  usually reached through Sources. This replaces the concept's renderPackage fallback that searched every Tweak
  Source by id.
- `tweaks.js`:
  - `addTweakButton`: the sheet's ADD (download, check, keep; ADDED: Remove; paid: Sign In / Buy) taken out of
    openAddTweaks so the page and the sheet share it. Look by option (sheet: `tw-add`/`on`; page: `price-btn
    tw-row-add`/`added`/`adding`). A module set remembers tweaks being added, so a recycled list row drawn again
    mid-add shows the spinner instead of a fresh ADD. preventDefault added: the button sits inside the row's link.
    It also removes a tweak added from Files (`r.file`).
  - `addTweaksItems` (pure): the groups and the filter (core/changes.js filterRows: name, id, description,
    author). Kept tweaks that aren't in the list (from Files) are listed under Added.
  - `moreTweaksGroup`: Browse Tweak Sources, Search All Repos (Canister), From Files…, one footer
    ("Only tweaks that work in <app> without a jailbreak are listed.").
  - `addTweaksGroup` (the row on an app's Details): with no `open` it pushes the page (`pushAddTweaks`); My IPAs
    still passes its own `open` (the pushed sheet, which also syncs its library entry), so it is unchanged. No
    footer naming tweaks: "They go in the next time it's signed." when some are added, none when only made-for
    ones exist. The count refreshes on hashchange (back from the page).
- `packages.css`: the button's place in the row (no chevron behind it), ADDED greyed as More Sources' ADDED, its
  dark colour; the eras already style `.price-btn.added` / `.adding`.
- Tests: `screens/tweaks-addtweaks-page.test.js` (groups, filter, ADD/ADDED/Remove, failure, More Tweaks footer,
  the row pushing, the route); the old "From your sources: …" footer assertion in tweaks-app.test.js now asserts
  no footer.

## Checks

- `node --test "web/app/**/*.test.js"`: 2981 pass.
- Chromium (tools/concept build + check.mjs, sideload, iPhone 15/16 size) from a scratch worktree with the concept's
  sample source and conceptInfo shim (not committed): the page lists 8 Made for YouTube + 3 Works in Any App,
  search "poomsmart pip" leaves YouPiP, no match shows "No tweaks match your search.", a row opens FLEXing's Details
  from the Tweak Source with back "Add Tweaks", back returns to the list, ADD on a .deb the sample can't serve
  shows "Can't Add This Tweak" and turns back to ADD. Shots in iOS 6 Classic, Gunmetal, iOS 7 White, iOS 13 White
  (ADDED and the busy spinner forced by script for the look). Found and fixed: iOS 7's outline button let the
  row's chevron show through, so the chevron is hidden on these rows.

## Spec review

Fresh subagent on the diff + brief. Kept as is, with why:
- My IPAs' library entry still opens the pushed sheet: it is not an app's Details (its route is not browse.js's,
  so `addtweaks:` would not render there) and its `open` re-syncs the library entry's tweaks.
- Back label: B302 is on main; Chromium showed "Details" on Add Tweaks and "Add Tweaks" on a tweak opened from it.
- The "They go in the next time it's signed." footer and the greyed ADDED come from the approved concept; the
  background check (checkForApp) is the sheet's existing behaviour carried to the page.
- From-Files rows have no page and no chevron; their ADDED button removes them.

## iPhone 15 Pro (brief asked; the real ADD downloads and checks a .deb through the native shell)

Gate-built Lite IPA (native/build/iFizBox.ipa, grep'd for renderAddTweaks) installed with `tools/ui-15.sh`,
driven by WDA taps plus Web Inspector CDP (`pymobiledevice3 webinspector cdp`) for routes. The phone's sources:
iFizBox's own, Chariz, Havoc.
- iFizBox's own Details: the Add Tweaks row pushed the page (back "Details"): 5 Works in Any App tweaks from
  Havoc/Chariz via the real Tweak Index, More Tweaks, footer "Only tweaks that work in iFizBox without a jailbreak
  are listed."
- `addtweaks:com.google.ios.youtube` (no source on the phone carries YouTube, so opened by route): Made for This
  App lists the YouTube tweaks; each package's Icon over its section icon as in Search.
- Real ADD on AskActionTube: spinner, then the row moved to Added with a greyed ADDED; ADDED > Remove sheet >
  Remove took it back out (phone left as it was).
- A row tap opened AskActionTube's Details from its Tweak Source, back "Add Tweaks".

## Not verified

- An app on a real AltStore source that tweaks are made for (YouTube) opened through its own Details row: no
  source on the phone carries one; the row was checked on iFizBox's own Details and the YouTube list by route.
- Paid Sign In / Buy from the page: no paid tweak bought on the phone; the code path is the sheet's (now shared).
- The background check (checkForApp) adding rows while the page is open: not exercised in Chromium (the concept
  shell serves no .debs); the code is the sheet's, re-wired.
- The Added group for a tweak added from Files, drawn on the page: covered by the node test of addTweaksItems,
  not seen in Chromium (needs a file picked).
