# F350: the Cydia Details page for packages and apps

Built from the approved concept (branch `concept/cydia-details`, commits after 54f793d9), against today's code. The
concept's own fixtures and pictures (native/fake status, core/fixtures, img/concept, source.json, shell.js's
concept.sample mapping) are not in this branch; they were used only in a scratch worktree for the shots below.

## What changed

- `web/app/screens/details.js` (new): what rows the Details pane has, worked out from plain facts so node tests can
  check each state (`packageRows`, `appRows`, `moreInfoShown`, `detailsFooter`), plus the DOM pieces both pages share:
  the dashed description box (`descGroup`, URLs stay links), Version's CHANGE price button (`changeButton`), tiles on
  someone else's rows (`tileCells`), the centred footer (`footerGroup`).
- `browse.js renderPackage`: nav title Details for every package page; the store header and Details | Reviews |
  Related stay (storeTabs, in place). Details pane, in order: Source Warning, Change Package Settings (installed) and
  Maintainer (when it isn't the author), Works In (sideload tweaks), payment, Can't Install Yet, the Package Queue
  row, Preview, the dashed box, More Information (long text or a depiction), Installed Package / Version (Version +
  CHANGE, Version History, Filesystem Content), Roll Back, Information with tiles (Source, Section, Works On,
  Installed Size, Depends), Conflicts, Other Sources, Links with globe tiles, Open In, Download .deb (site), Block
  with tiles, the footer. New pages: More Information (`info:`: whole text, a Sileo depiction drawn there with its
  What's New, or a Depiction row for an HTML one), Change Package Settings (`pkgsettings:`: the switches only, from
  installedGroup with `version: false`), Files (`files:`: the paths dpkg lists).
- `altstore.js renderApp` changed in place (its install rows, Where It Comes From, Mark as Installed, App Store
  lookup and IPA checks all stay): the tiles row is gone; Add Tweaks has its tile and no footer (user 2026-11-21:
  at most the row's own detail, "27 for This App"); Preview; the dashed box (the App Store's text when the source has
  none); More Information (long text, What's New, Permissions); Version with CHANGE (Install Which Version?) and
  Version History, "Updated <date>" under it; Information with tiles; Links with tiles; `tail` for browse.js's
  Wish List (now with its tile) and Installed App; the centred footer. `appInfoNodes` is the app's More Information.
- Gallery header "Screenshots" -> "Preview" (and the zoom's and spinner's labels).
- `rowicons.js`: envelope, laptop, badge, folder glyphs (iOS 6 and iOS 7 line versions) and the pkg* tiles.
- CSS: packages.css (box, clamp to 6 lines, CHANGE spacing, centred footer, file paths); `--cy-desc-inset` era hook
  in style.css (iOS 7: 15px, so the box isn't cut by the screen edges); ios7/ios13 centre `.cy-foot` and dash the box
  in `--keyline` (iOS 13 dark's table edge is the ground's colour). Price buttons already had the eras' look (B298),
  so CHANGE needed no era rule of its own.
- Filesystem Content: `apt.files { id }` in native/Sources/Apt.swift reads dpkg's `info/<id>.list` (or
  `<id>:<arch>.list`); backend-native.js offers `packageFiles` in the jailbreak build only; the fake shell answers it
  too. The row shows only where the backend has `packageFiles`, so never on the site or in Lite.

## Decisions (unattended run)

- CHANGE is always on the Version row, greyed (disabled) when there is no other version to pick or the package is a
  sideload tweak (Add to App picks apps). The concept always drew it; a live button that does nothing would be worse.
- Filesystem Content is read by the app's shell, not the root helper: dpkg's info lists are world-readable, like
  dpkg's status file the shell already reads (`apt.dpkgStatus`). The brief said "through the helper"; no root needed.
- Behaviour the old page had and the concept didn't show is kept, placed where it fits the new order: Package Queue
  row, Roll Back, Conflicts, other sources' versions (now "Other Sources"), Open In, the site's Download .deb. The old
  Depends group with links went (Depends is an Information row now, as the concept has it), and so did "More by
  <author>" (the header's author link opens the same page) and the Links group's source row (Information's Source).
- The App Store's description card (B271's grow-in-place More) is gone from Details: its text fills the dashed box
  when the source has none, and More Information shows it whole.
- The concept's v4 Reviews / Related pages (`reviews:` / `related:` tokens) were left out: v5 shows both in place.
- Nav title of Change Package Settings: "Settings"; of Filesystem Content: "Files".

## Checks

- `node --test web/app/`: all pass (new `screens/details.test.js`: rows per state, installed / not, paid,
  installed-only, sideload tweak, depiction / none, long / short text, app with and without permissions and notes,
  the DOM pieces, the CSS centring, the fake shell's apt.files).
- Chromium, the concept tooling (tools/concept/build.py + a 3x copy of check.mjs, in a scratch worktree with the
  concept's sample fixtures): Cask 3 (installed, Chariz) in the jailbreak build and iFizBox's own app in the
  sideload build, iOS 6 Classic / Gunmetal, iOS 7 White / OLED, iOS 13 White / OLED; More Information (package in
  iOS 6, app in iOS 7), Settings (Gunmetal) and the site's app page. Shots in `shots/` (iPhone 15/16 size, 3x, JPEG):
  `jailbreak-*` the package, `sideload-*` the app, `-0` top, `-1` scrolled, `-3` the bottom.
- The concept check printed two FAILs in iOS 13 ("Home tab from Settings draws all 11 rows again: covered
  group.home-links"): its Home re-tap check on Home, not the Details page.

## Not verified

- The real phones: Filesystem Content against a real dpkg (Swift `apt.files` compiles in the gate's native build but
  wasn't run on the iPhone 7), and the Lite build's page on the iPhone 15 Pro. Chromium with the fake bridge covers
  the web side (AGENTS.md: phone only when Chromium can't check); the Swift reader mirrors the fake shell's, which is
  tested.
- A Sileo depiction's More Information and the Files page with real paths were not shot: the sample has no Sileo
  package and the concept shell has no dpkg info lists (the page then says "No files listed.").
- An app with Permissions on More Information: iFizBox's own sample app lists none; the rows come from the same
  permissionRows the old group used, and the plan test covers when the row shows.
