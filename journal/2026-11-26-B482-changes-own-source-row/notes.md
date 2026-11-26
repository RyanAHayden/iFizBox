# B482 Changes' Installed scope: the installed app's own source's row

## What I did
- `core/catalog.js`: a worker op `row(id, key)`: one source's row for an id, as its list shows it (filters, hidden
  sections, Works on My Phone) but kept when another source has it newer: `list(key)` drops that row when Newest Copy
  Only is on, which is exactly this case, so it could not be used.
- `core/changes.js`: `ownPicks(rows, appRecords)` gives `[key, id]` for each remembered app whose All Sources row comes
  from another source (`ownKey`). `dayGroups(..., { own })` adds those rows, dated by their own source's records only
  (key + id, not id), marked `own: true`. `filterRows` drops `own` rows outside the Installed scope, so All still shows
  All Sources' copy; the Installed scope keeps them (B477's `isInstalledRow` matches their key).
- `catalog.js` `changes()`: reads `apps()`, asks `row` for each pick, passes them as `own`.
- `screens/changes.js` needed no change: `itemsOf` filters through `filterGroups`.
- Test: `core/changes.test.js` "B482" builds the real catalog (AppTesters 1.0 -> 1.1 today, fastsign 2.0): Installed
  shows AppTesters' 1.1 (updated, today), All shows fastsign's 2.0.

## Not verified
- Not checked in Chromium or on a phone: the change is in the data the list draws from, covered by node tests
  through the real catalog and filters; the drawing code is unchanged.
