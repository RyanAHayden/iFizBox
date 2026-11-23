# B412: Update Automatically and Ignore This Version ignore case in package names

- `core/settings.js` autoMarked has/set: `sameId`; a mark keeps the spelling it was made with, off removes every one.
- `core/settings.js` ignoredVersions get/set: the same. The store holds packages and apps alike, so an app's callers
  (`screens/altstore.js` versionButtonOf, `screens/browse.js` versionRowItems on a `remembered` row) pass
  `{ dpkg: false }`, as holds does, and its bundle ID stays exact.
- `core/appupdates.js` splitIgnoredVersions: a package's row matches a version stored under any spelling (as the
  daemon does); `remembered` rows match exactly. settleIgnoredVersions (and `app-updates.js`, its installed versions)
  likewise, or an oreo entry would never be dropped once Oreo moved on.

Tests: `core/package-ids.test.js`.

## Not verified
- On a phone: no package with capitals was marked or ignored there; node tests only.
- A package and an app whose IDs differ only by case share the store without a kind, so a package's lookup or
  undo can still meet the app's entry. Left: no such pair is known.
- Account sync's lines (applyVersionLines) stay exact, as they do not say which kind an ID is. Two spellings synced
  from two devices both hide their version; pressing the button merges them.
