# B326 Related tab: the section list's icons, not letter tiles

## What was wrong

The Related tab's rows (`relatedRow`, `web/app/screens/browse.js`) drew a letter tile with the package's own
picture over it. The own picture loads exactly as in the section lists (same `iconSrc`, same URL), and in
Chromium every Havoc and Chariz row showed its icon (both repos ship an https `Icon:` on ~97% of packages).

The letter tiles came from packages whose `Icon:` no page can load. BigBoss (a default source) has 9,974
packages; 4,280 of its `Icon:` lines are `file:///Library/...` or `file:///Applications/...` paths on the device
(PreferenceLoader icons that exist only once the tweak is installed), and only 7 are https. Its tweaks are most of
those. A section list shows Cydia's section icon for them (`core/sectionicons.js` `packageIcon` fallback: the
section's icon, else `unknown.png`); Related showed a grey letter. So "most rows show only the letter tile,
tweaks especially".

Ruled out: missing `icon` on `catalog.list` rows (present); repo-relative Icon paths (`core/apt.js` `resolveIcon`
already resolves them); the `.store-related-icon` CSS (the picture gets `.loaded` and shows in every Era);
`iconBad` (only icons that really failed).

## What changed

- `relatedRow` takes the fallback from `packageIcon(r)` and passes it as the tile's background (nav/ui.js
  `icon.color`, which lands in `--cell-icon-tint`), with no letter. The own picture still loads over it and stays
  hidden until it loads; a failed or missing picture leaves the section icon, as in the section list.
- `packages.css`: the comment above `.store-related-icon` says so.
- `screens/storepage.test.js`: the B41 test now checks the src (https, http, file:/// refused) and the fallback
  (Tweaks, Themes, unknown section) of each row.

The purpose badge that section lists hang on the icon's corner is not drawn in Related rows (their small grouped
cells never had one); not asked for.

## Checks

- `node --test web/app/screens/storepage.test.js`: 18 pass.
- Chromium, jailbreak-app mode with the fake bridge (capture.mjs from journal/2026-11-21-b298-price-btn-eras, a
  fake phone dir holding today's Havoc, Chariz and BigBoss Packages files), served by `worker/node.mjs`:
  - `bigboss-before-after.png`: BigBoss Tweaks section list (left), a tweak's Related tab on main (middle,
    letter tiles), and on this branch (right, the Tweaks icon as in the section list).
  - `havoc-after-ios26.png`: Havoc's Related tab on this branch in iOS 26: own icons still show over the fallback.
  - Before the fix, Havoc's Related tab already showed icons in iOS 6, 7, 13 and 26.

## Not verified

- On a phone (iPhone 7 WKWebView): Chromium could check everything this change touches (a CSS background and an
  `<img>`), so no phone lock was taken, per AGENTS.md.
- Dark appearance: the fallback is the same Cydia PNG the section lists use in dark, not shot.
