# B363: a Maintainer's page said "No packages." even for BigBoss

Tapping a package's Maintainer on its Details page opened the author page, and for BigBoss it said "No packages."
Their index has about 9,100 packages with "Maintainer: BigBoss <bigboss@thebigboss.org>", so the page should have
listed them.

## What I found

Name parsing was fine: `parseAuthor` gives "BigBoss", and the compare was already lower-cased. Two things emptied
the page:

1. **Zero rows in the sideload build.** The sideload build loads an APT source as a Tweak Source, which stays out of
   All Sources. `author()` only looked at `fitOf(ALL)`, so a Tweak Source's packages were never looked at. With
   BigBoss as a Tweak Source on iOS 27, `author("BigBoss")` returned 0, although that source's own list had 4,347.
2. **Dropped rows with Works on My Phone on.** `author()` removed everything that can't work on the device, and said
   nothing. BigBoss's packages are mostly rootful. Loaded with arch `iphoneos-arm` on iOS 16.5 rootless, the page had
   16 of 9,109 rows before the change and all 9,109 after.

Also, a name with different spacing ("Big  Boss", "Big Boss") did not match "BigBoss". Names now compare with
spaces left out.

Misfits on the author page are drawn as Search draws its exact-match misfit (red name, the reason as subtitle),
in name order with the rest, rather than greyed or under a footer: it is the look the app already uses for "this
can't work here" in a list, and one name-sorted list keeps the A–Z index working.

The jailbreak app and the site load sources with the device arch (`iphoneos-arm64`), so BigBoss's rootful packages
are never loaded there. `author("BigBoss")` gave 17 rows before and after the change, out of the 38 arm64 and all-arch
packages. That is not a regression, and loading other arches is a separate feature, so
it is out of scope here.

## What changed

- `web/app/core/catalog.js` `author()`: the pool is `appsAndTweaks()` when the sideload build is on, the same pool
  the unfiltered Search uses, and `rowsOf(ALL)` otherwise. Names are compared with spaces left out, as
  well as lower-cased. Misfits stay in the list, marked `{ misfit: true, why }`, where `why` is the reason the package can't work
  here. Hidden sections and blocked ids still stay out. The header comment for
  `c.author(name)` says so.
- `web/app/screens/browse.js` `flaggedRow(item)`: new helper. A row is flagged when it is Search's exact match or
  the author page's misfit, and it can't work. A flagged row gets its name in red and the reason in place of its
  description. `bindRow` and `markQueued` both use it.
- `web/app/core/catalog.test.js`: new test "B363: the author page keeps what can't work, marked, and spacing or case
  never hides a name". The first version of the fixture failed: `load()`'s fourth argument (arch) drops other-arch
  stanzas, so with `iphoneos-arm` the arm64 row was missing. I fixed the fixture's expectations to match that load.

Sample numbers from the real BigBoss index (`http://apt.thebigboss.org/repofiles/cydia/dists/stable/main/binary-iphoneos-arm/Packages.bz2`):
9,098 stanzas with "Maintainer: BigBoss <bigboss@thebigboss.org>", 80 with "Bigboss", 9,933 `iphoneos-arm`, 1
`iphoneos-arm64`, and 37 `all`.

## Check

Node against the real catalog code, not Chromium: the numbers above, from loads with the real index. The author page
gave 4,210 rows from BigBoss as a Tweak Source on iOS 27, against 0 before. With Works on My Phone on, arch
`iphoneos-arm`, iOS 16.5 rootless, it gave all 9,109 rows, against 16 before.

## Not verified

- No Chromium reproduction. The site build in Chromium does not show the bug: 17 rows before and after with the real
  index, on an arm64 load. The failing path is the sideload build, which needs a native bridge that fakes a
  non-jailbroken iOS 27 device, plus a local copy of BigBoss as a Tweak Source. That was done in node against the real
  catalog code instead.
- Not checked on a phone. On the iPhone 15 Pro sideload build, the red misfit rows on the author page were not looked
  at on screen. The drawing is the same code path that Search's exact-match misfits use, so the rows should match
  Search, but nobody has seen them.
