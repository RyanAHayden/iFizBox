# B344 App Sources is Find More's page, Add All included

User report: App Sources (More Sources > Find App Sources, `#/sources/more/apps`) had no Add All and didn't look
like Find Tweak Sources' Find More page.

## What changed

- `screens/moresources.js` `renderApps` / `drawApps`: the page is now built as `findmore.js renderFind` builds Find
  More: a search bar pinned under the nav bar (`Search Sources`, filters the directory here by name, reason or URL;
  nothing is asked over the network), one plain list (`.table.plain.rec-list.find-list`) with a section per group
  (From the Developer, Modded Apps), Find More's rows (`source-row rec-row find-row`: icon, name, one line, the
  `.find-add` ADD / ADDED price button), "No app sources found." when the search matches nothing, and the footer
  styled as Find More's (`find-credit`). The "None of these sources answered" note is kept.
- Add All in the nav bar (`nav` returns `right: Add All` for `apps`): `addAllApps` runs `findmore.js addAllListed`
  over the rows the page shows. `addAllListed` took `noun`, `input`, `nameOf` and `title` options so both pages run
  the same code: one action sheet ("Add the 22 sources listed here that aren't in your sources yet?"), each source
  in turn under the counting HUD, failures named in one "Some Sources Failed" alert. Find More's own wording is
  unchanged ("repo").
- Tests: `findmore-addall.test.js` gains three B344 tests (nav Add All, Find More's list/rows/ADD, Add All's sheet,
  adds, count and failure alert, the "every source" alert, search filter and the rows Add All works on).
  `findappsources.test.js` and `moresources.test.js` read the rows as `.find-row` and the headers as
  `.section-header` (the old grouped `.rec-more-row` cards are gone from this page; More Sources' Recommended keeps
  them).

## Decisions

- The title stays "App Sources" (the user's name for it), not "Find More": two pages called Find More side by side
  in the Sources stack would be ambiguous.
- Rows carry no trust pill: Find More's pill comes from Canister's tiers, which app sources don't have. The second
  line is the source's short reason (`shortWhy`), cut to one line as Find More's.
- No "Other Directories" section: there is no outside directory of app sources we point to.

## Checks

- `node --test` on findmore-addall, findappsources, moresources and findmore tests: 37 pass.
- Headless Chromium as the sideload app (`capture.mjs --mode sideload`, copied from B272's journal; web/app served
  on 127.0.0.1:8817), iOS 6 style: `shots-ios6/find.png` (Find More) and `shots-ios6/apps.png` (App Sources), side
  by side in `shots-ios6/side-by-side.png`: same nav bar Add All, same section header, rows and ADD buttons.
  `apps-bottom.png` (Modded Apps and the footer), `apps-addall-sheet.png` (tapped Add All: the sheet with the
  count; not confirmed, nothing added).
- `tools/check.sh` via `run done`.

## Tried and failed

- The first capture's `clicktext: "Add All"` clicked More Sources' Recommended Add All on the page under the stack;
  the second run (`addall-ios6.json`) clicks the visible nav bar button instead.

## Not verified

- iOS 7 / iOS 13 styles and dark themes: not shot; the page uses only Find More's classes, which B272 shot in all
  three styles.
- Real-device check on the iPhone 15: not done; the page is web only (no native change), and Chromium covers it.
- A confirmed Add All against live sources: the shots only open the sheet (adding needs the real backend's
  network fetches; the tests cover the adding with a fake backend).
- The search bar does not show in either shot (in both pages alike, the pinned bar sits under the Upgrade banner of
  the fake shell); not looked into, as it is the same for Find More.
