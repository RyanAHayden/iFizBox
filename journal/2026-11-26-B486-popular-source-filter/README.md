# B486: Source filter on Browse lists

**Cause.** catalog.refine and the Filter panel's Source rows were right (checked with two sources through the panel in
node, and through every Browse list's rows). The Popular list, though, is `catalog.popular()`: only its first 50. A
Source picked there filtered those 50, so a source's packages outside the cut were missing.
New, Updated, Featured and Free lists are whole, so they were fine.

**Fix.** `renderSearchableList` takes `wide: { rows, limit }`. With a filter set, it filters the whole pool
(`wide.rows()`, read once per load), keeps the first `limit` that pass, then sorts. Popular passes it (home.js LIST_VIEW).

**Test.** browse-listfilter.test.js: a list cut to 2 of 6 rows, pick Beta / Alpha / All Sources in the panel.

**Not verified.** Not on a device: the real Popular list with many sources (node only, fake backend sources).
The user's report did not say which list; Popular is the one the code shows to be wrong.
