# B290: author pages crashed before their list

## What was wrong
`renderAuthor` (web/app/screens/browse.js) called `classList.add("author-hide")` on what `grouped()` returns. That is a
DocumentFragment, which has no `classList`, so every author page threw
`TypeError: Cannot read properties of undefined (reading 'add')` and showed nothing under the nav bar.

## What changed
- The class now goes on the fragment's `.group` div (`g.querySelector(".group")`; the spec review pointed out that
  `firstElementChild`, the first try, assumed the group came first).
- New node test `web/app/screens/browse-author.test.js` renders an author page through `browse.render` with the fake
  DOM and a stubbed `catalog.ensure` / `catalog.author`. It checks that the `.group` carries `author-hide`, comes
  before the package list, and that an author with no packages gets the group plus "No packages.". The fake DOM
  gives fragments a `classList` (which is why no test caught this), so the test checks the class on the `.group`
  element. It fails on the old code (both cases) and passes with the fix.

## Chromium check
Scratch script (not committed) served web/app on 127.0.0.1, opened `#/search/author%3AJane%20Doe` in headless
Chromium with an iPhone user agent, as the website and as the jailbreak app (fake bridge):
- old code: `unhandled rejection: TypeError: Cannot read properties of undefined (reading 'add') at renderAuthor
  (browse.js:1018)`, the same error the user reported; page empty under "Jane Doe".
- fixed code: no errors; "Hide Packages by Jane Doe" in a `div.group.author-hide`, then "No packages.".
- fixed code, website, with `catalog.ensure` / `catalog.author` stubbed in the page (three rows): no errors; the
  Hide row, then Alpha / Beta / Gamma under A / B / G headers, and the A–Z index. Seen: the index overlays the
  right end of the Hide row, as it does other rows; left alone (not this task).

The package page's Developer / Maintainer / More by / header author links all push `token("author", …)` onto the
route, which `render()` sends to the same `renderAuthor`.

## Tried and failed
- First Chromium run showed the desktop landing page: it needs the iPhone user agent (as tools/smoke does).

## Not verified
- Tapping Author on a real package page in Chromium: offline there are no sources loaded (the site's Worker `/api/`
  is not served locally), so there is no package page to tap from. The author route was opened directly instead;
  the links reach the same function (see above).
- The author page with real catalog data in Chromium (same reason): the list was checked with stubbed rows only.
