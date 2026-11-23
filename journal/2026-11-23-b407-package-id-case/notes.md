# B407: package ids match ignoring case

## Cause
dpkg's status and apt write every package name in lower case (oreo), while a source may spell it Oreo. The app compared
the two exactly, so on a jailbroken phone an installed Oreo did not show as installed, was listed twice and got no
upgrades.

## Fix
- `core/apt.js` (no module of its own: the startup module cap): `IdMap` and `IdSet` are a Map and a Set that look ids up ignoring ASCII case, plus `sameId`
  and `withLowerIds`. Their keys come out in lower case, so the spelling to show or send is taken from the value
  (a row's id, a stanza's package), never from a key.
- `core/catalog.js`: APT sources' maps, the All Sources merge (jailbroken only; without a jailbreak it holds only
  AltStore apps, whose bundle IDs stay exact, as do AltStore sources' own maps), the status map and the blocked ids
  use the ignore-case maps. `installed()` rows carry the source's spelling. `versions()` keeps each source's own
  spelling for Changes' records.
- `core/installed.js`: findUpgrades, dependedOn, Auto-Installed marks and install dates match ignoring case.
- `core/deps.js` (outside the task's file list, needed because `catalog.deps()` resolves Depends there): index and
  self compares ignore case.
- `screens/browse.js`: the package page's installed row, the Installed Package group and Block's installed check use
  `sameId`.
- After the spec review, since installed ids now carry the source's spelling: `core/settings.js` holds (has, set),
  `core/wishlist.js` and `screens/safety.js` installedPackages ignore case.
- `screens/queue.js` `namesFor`: labels are looked up under the lower-case id too, which also serves queuerun.

## Tests
- `core/package-ids.test.js`.
- All 3494 node tests in `web/app` pass. The first gate failed on module-graph.test.js (a new `core/idmap.js` was the
  118th startup module), so the helpers moved into `core/apt.js`.

## Not verified
- On a phone with an installed Oreo: Chromium and node suffice under the repo rule.
- A Chromium shot of the package page. The logic is covered by the node tests; the three compares in `browse.js` are not.
