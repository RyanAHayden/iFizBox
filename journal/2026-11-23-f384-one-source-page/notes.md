# F384: one source page (2026-11-23)

Every source page now has the same shape: a header card, up to five apps on the page, description and news, then
one Information group with icons. The option approved on concept K4
(https://claude.ai/artifact/XKJD9dFHeab1BVHZEaGSnc) is built, plus the approval's extra: holding the Website row in
Information opens iOS 6's black menu with Copy URL, as a source row's hold on Sources does (`nav/menu.js` longPress
and `showMenu`).

## What was done

- The concept's code was still uncommitted in its scratch worktree (branch `concept/source-page`). It was ported to
  `web/app` and the scratch worktree was cleaned up.
- `web/app/screens/sourcepage.js` (new): `sourceHeader`, `aptHeader`, `infoGroup` and `shortUrl`.
- `web/app/screens/altstore.js`: the page shows up to 5 apps (featured first), then an All Apps row only when there
  are more. News is capped at 3. The Featured group and the lone Website row are replaced by `infoGroup`.
- `web/app/screens/browse.js`: the APT page gets `aptHeader` on top and `infoGroup` in place of the health footer
  line and Canister's separate "Trust" group. The empty-sections note now says "Works on My Phone hides the rest."
- `web/app/rowicons.js`: new tiles `srcTrust`, `srcWebsite`, `srcStatus`, `srcUpdated`, `srcRelease`, `srcHttps` and
  `srcSigned`. The iOS 7, 13 and 26 sets derive from them.
- `web/app/altstore.css`: `.source-head` rules for the header card.
- Removed `canisterFactsSlot`, `canisterFactsGroup` and `yesNoUnknown` from `browse.js`, and their test
  `browse-canister.test.js`. Their behaviour is now tested in `web/app/screens/sourcepage.test.js` on `infoGroup`:
  Canister facts show only for APT, nothing shows when Canister doesn't list the source or is offline, and plain
  http is flagged.
- Behaviour change: a Canister fact the app doesn't know is left out, where it used to show "Unknown". The concept
  showed it that way.
- "Updated" and "Last Release" use `core/health.js`'s `ago()`, capitalised ("Yesterday", "3 days ago"), instead of
  the concept's own copy of it.

Checks:

- `node --test web/app`: 3310 tests pass.
- Chromium, via `tools/concept/build.py --standalone` and `tools/concept/check.mjs` with a `--probe` that opens the
  page:
  - Chariz in Jailbroken mode: header card, Works on My Phone, sections, and Information with Trust Known Safe. Light
    Classic and dark Gunmetal both clean.
  - iFizBox's own AltStore source in Lite: header, App group with the app inline, Description, and Information with
    Trust, Website and Updated.
  - A synthetic touch hold on the Website row opened the menu with Copy URL.
- The only check failure in that run was Chromium refusing `navigator.vibrate` (haptic), because the probe's
  synthetic pointerdown had no user activation. That is an artefact of the probe, not the app.

## What failed

`check.mjs`'s `--route` is undone by its own Home re-tap and device change before the shot, so the page was opened
from `--probe` instead.

## Not verified

- Not run on a phone (iPhone 7 or 15). This is a web-only change, and Chromium covers it under AGENTS.md's phone rule.
- Canister's HTTPS and Signed Releases rows were not seen live in Chromium, because the concept sample has no
  Canister answers. Unit tests only.
- Not looked at in the iOS 7, 13 or 26 styles, or on iPad, in Chromium.
- An AltStore source with more than 5 apps (the All Apps row) and one with News were not shot. Covered by reading
  the code only.

## Spec review

- Fixed: the apps group now lists only apps the source's list shows (featured ones first, if they run here), and
  All Apps, its count, the App/Apps header and the "No app … runs" footer all follow that list, so they agree
  (before, featured apps that don't run here could show above that footer). The AltStore header now uses the shared
  `sourceHeader()` too.
- Kept on purpose: News capped at 3 and the "Works on My Phone hides the rest." note came from the approved concept
  ("as shown"). APT repos have no website field, so only AltStore sources get the Website row and its hold menu. An
  APT repo's Release Description shows as the header subtitle, as the concept showed it, not as an About group.
- Left as is: the page waits for `catalog.list` before drawing Description, News and Information. It is a local
  worker call on a catalog already loaded for the source's meta. Not timed on a phone.
