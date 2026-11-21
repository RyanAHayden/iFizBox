# Back label follows a title set later

A page opened before it knows its name (a package page by id: deep link, Installed, Search) showed its id on the
back button of every page pushed above it: app.js took `entry.back` from `nav()`'s title once, and browse.js's
later `setTitle` only changed the shown title.

## What changed

- `web/app/nav/go.js` `backFollowsTitle(entry)` (first tried as its own module, nav/backlabel.js: that put app.js's
  startup closure at 117 modules and failed module-graph.test.js's cap, so it sits beside pageHandle instead): wraps the page handle's `setTitle` so a new title also
  becomes `entry.back` (only while `entry.back` still equals the old title, so a screen's own `back` stays), and
  the back button of the page right above (the next `.nav-item` in the tab's nav stack), when it still reads the
  old title, takes the new one and its aria-label.
- `web/app/app.js` makePage calls it for every page.
- Differs from branch concept/add-tweaks: that one rewrote every `.bar-button.back` in the whole document whose
  text matched, which could hit another tab's page with the same label; this one touches only the page above, and
  also updates the aria-label.

## Checks

- `node --test web/app/nav/backlabel.test.js`: package page by id, Version History pushed, setTitle -> back reads
  the name; a page pushed later reads it; a screen's own back label stays; Section Visibility's title round trip.
- Chromium (headless, real `web/app`, fake bridge), scratch script: deep link `#/search/package:com.google.ios.youtube`,
  name given through `handleOf(body).setTitle` as browse.js does, then Version History pushed: back read `YouTube`;
  renamed again while Version History was on top: back and aria-label followed. No page errors.

## Not verified

- The name arriving from real source data (browse.js loading the package): the fake bridge answers null, so the
  Chromium check gave the name through the same page handle call browse.js makes instead.
- On a phone: not needed (pure web/app nav code; AGENTS.md "Phone only when Chromium/local can't check").
