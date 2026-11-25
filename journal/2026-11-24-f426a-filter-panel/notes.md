# F426a: Search's Filter panel moved to its own module

## What I did

- Code: the panel moved out of `web/app/screens/search.js` into `web/app/screens/filterpanel.js`. It exports
  `openFilterPanel({ filters, anchor, alive, changed, closed })`, which returns `{ close }`, plus `emptyFilters()`,
  `searchFilters` and `sourceChoices`.
- The page's filters object is changed in place. Only one panel is open at a time; opening one closes another. `alive()`
  is asked on each hashchange.
- Search keeps its own `drop` handle for its Done and Filter words, reselect and focus.
- Clear Filters' class is set on its own group now, not through `.group:last-child`. Same result; the test fake DOM has
  no `:last-child`.
- No user-visible change, so no release note. `GLOSSARY.md`: Filter panel added.
- Tests: `web/app/screens/filterpanel.test.js` (two pages' filters stay separate; one panel at a time; closes on leaving).
  `web/app/screens/search.test.js` only changed its imports.

## Checks

- Chromium on the site (402x874), old copy from `git archive` against this branch. The same states matched at every
  logged step: open and Done; pick Not Installed and Free; the Clear Filters row; closed with Filter selected; Clear;
  leaving for Sources while open closes it; focusing the field closes it; Search's reselect closes it.
- The three shots (open, filters set, closed) were byte-identical between the two copies.
- Leaving was covered by a second script and focus and reselect by a third: the earlier ones closed the panel another
  way first, or aimed at another page's field.

## Not verified

- Jailbreak and Lite builds' real shells.
- Other eras and dark mode were not shot (no CSS changed).
- Search's copy pushed on Home was not clicked through.
