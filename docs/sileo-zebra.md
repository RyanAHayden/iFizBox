# What Sileo and Zebra do, and how iFizBox compares

From Sileo `c9f7015` (2024-10-08, github.com/Sileo/Sileo) and Zebra `e2f3c27` (2026-11-15,
github.com/zbrateam/Zebra). File paths below are relative to those repos.

**Licences.** Sileo is BSD-4-Clause (its `LICENSE` clause 3, the advertising clause, can't be combined with the GPL):
take **ideas only**, never its code. Zebra is GPL-3.0, like iFizBox: code may be reused, with credit in the file
header and on the Credits page. iFizBox is web code and Zebra is Objective-C, so in practice nothing copies code
from either app; iFizBox takes behaviour and writes its own JS.

**Short version.** iFizBox has what these two apps are known for: Canister search for sources you haven't added,
with Add Source & Install in the jailbreak app; `sileo-featured.json` banners; native Sileo depictions
(`screens/depiction.js`) including the Sileo-only views; the Payment Provider API; plain-language dependency
errors; Recent Searches; a Wish List; blocking packages by author; refresh skipping by Release fingerprint; and
ETag/Last-Modified caching.

## Search

### Sileo
- **Where it looks:** `Backend/Package Manager/PackageListManager.swift` `packageList(search:)`. It does a substring
  match (`localizedStandardContains`, so case and diacritics are ignored) on package id, Name, Author name and
  Maintainer name. It doesn't search the description.
- **Narrowing cache:** `UI/PackageListViewController` keeps `searchCache[query] = results`. On the next keystroke
  it finds the longest cached prefix of the new query (dropping characters from the end until one matches) and
  filters only those results, not the whole package list. Typing "snowb" therefore filters the results for "snow".
- **Ranking:** `sortPackages`: names starting with the query come first. Ties go to the name closest in length to
  the query (`name.count - query.count`), then alphabetical order. "Snowboard" therefore ranks above
  "Snowboard Classic Theme".
- **History:** words go into `UserDefaults["UserSearchHistory"]` when Search is pressed. The empty search page shows
  them as a list with a Clear button. Bug: the setter saves `Array(Set(newValue))`, so the order is lost and there's
  no cap.
- **Canister global search:** `Backend/Canister Resolver/CanisterResolver.swift`. 0.5 s after typing stops,
  queries of 2+ characters go to `api.canister.me/v2/jailbreak/package/search?q=`. Queries already asked are skipped
  for the session. Results ("provisional packages", minus bootstrap repos) show in their own section under the local
  ones. Tapping **Get** on one calls `queuePackage`, which adds its repo. When the refresh finds the package,
  `queueCache()` puts it in the install queue on its own, so the user gets **one tap from search to queued**. A
  Settings switch (`ShowProvisional`) turns it off.
- **Telemetry:** `ingest(packages:)` POSTs every installed package's id, version, author and repo to Canister's
  `/download/ingest`, along with device headers. iFizBox does **not** do this. Zebra puts Canister behind a privacy
  screen (`Tabs/Home/Canister Privacy Controller`).
- **Piracy check:** `CanisterResolver.piracy(urls)` asks Canister's `/repository/safety` before adding a source.

### Zebra
- **Where it looks:** `Database/ZBDatabaseManager.m` runs SQLite queries. A scope bar under the field picks one
  field: **Name | Description | Author**. Name search is
  `WHERE NAME LIKE %q% ORDER BY arch weight, (exact = 1, prefix = 2, else 3), NAME COLLATE NOCASE`.
- **Live vs. full search:** with Live Search on (a Settings switch), each keystroke fetches only 7 columns with
  `LIMIT 30` (`ZBProxyPackage`). Pressing Search fetches every result in full.
- **Short queries:** a one-character query is ignored when the character is Latin (`< 0xFF`) and allowed for CJK
  scripts (`ZBSearchTableViewController.m`).
- **Recent searches:** the last **5** searches, newest first, no duplicates (`MAX_SEARCH_RECENT_COUNT`). They're
  saved when Search is pressed, show as a table on the empty Search page, and a Clear button removes them. Tapping
  one runs it again.
- **Filters:** `Tabs/Home/Settings/Filters` hides whole sections and **authors** (and blocks packages by author)
  everywhere: lists, search and Changes.

### iFizBox
`screens/search.js` with `core/catalog.js search()`, run in the worker:
- Every word must appear somewhere in name, id, description, author or maintainer.
- Rank tiers: exact name or id, then prefix, then the query starting a word in the name or id ("board" in "Snow
  Board", not "Keyboard"), then substring in name or id, then author or maintainer. Within a tier: name length
  closest to the query, then how many sources list the package, then by name.
- Any non-blank query searches locally, one character too (`core/catalog.js searchable()`; Zebra's
  one-Latin-character rule is not used). Canister needs two characters: it accepts one CJK character but answers
  nothing for it, so it isn't asked.
- 120 ms debounce. A scope bar (All, Tweaks, Themes, Apps) plus a Filter panel (section, source, installed,
  free/paid, Show Incompatible).
- Canister "Other Sources" under the local results (`screens/extras.js discoveryGroup`, 10-minute cache,
  `core/canister.js`).
- **Recent** (from Zebra): with the field empty, a grouped table of the last five queries, newest first, no
  duplicates, with Clear; tapping a row runs it.
- No narrowing cache: each keystroke scans every row, which is cheap (below).

### Search cost

`core/catalog.js search()` timed per keystroke in desktop node 26 (Ryzen 7 9800X3D) with every default source loaded
(6 typed queries, 39 keystrokes, median of 15 runs each):

| Load | Rows | Typical keystroke | One-letter query | Worst single run |
| --- | --- | --- | --- | --- |
| arm64 (what a modern phone reads) | 2,614 | 0.24 ms | 0.5–0.7 ms | 1.6 ms |
| arm + arm64, every APT source twice (heaviest) | 12,919 | 1.25 ms | 3.4–4.3 ms | 7 ms |

Every keystroke is far below a 16 ms frame, so a Sileo-style narrowing cache isn't worth adding. The scan over
`_hay` is ~1 ms per 10k rows. One-letter queries cost the most because they sort thousands of hits. Not timed on a
phone: the 4S is a reference device only and never runs iFizBox.

## Canister: from search result to installed

Sileo goes from a Canister result to the install queue in one tap: add the repo, refresh, then queue the package.

**iFizBox.** In the jailbreak app the Other Sources alert (`screens/extras.js offer`) offers **Add Source &
Install**: it adds the source, refreshes that one source, opens the package page and queues the package, which
brings up Confirm as usual. On the site and in the sideload build it offers Add Source.

iFizBox has its own static piracy list (`core/warnings.js`, plus Canister's MIT list copied into
`core/piracy-list.js` at release time). Asking
Canister live would send every added source URL to a third party, so the list stays static.

## Native depictions (Sileo JSON)

**The format.** A package's `SileoDepiction:` field points at JSON shaped like
`{ class: "DepictionTabView", tabs: [ { tabname, class: "DepictionStackView", views: [...] } ], tintColor,
headerImage, minVersion }`. Sileo creates each view from its `class` name (`DepictionBaseView.view(dictionary:)`)
and skips classes it doesn't know.

**Views Sileo has**, from `UI/PackageViewController/DepictionView/*`:
- Layout: TabView, StackView, AutoStackView, LayerView, SpacerView, SeparatorView.
- Text: HeaderView, SubheaderView, LabelView, MarkdownView (fast; `useRawFormat` switches it to the slow HTML path).
- Media: ImageView, ScreenshotsView, VideoView.
- Tables and buttons: TableTextView, TableButtonView, ButtonView.
- Sileo-only: **RatingView** (stars from `rating`), **ReviewView** (`title`, `author`, `rating`, `markdown`; built
  from Rating, Subheader and Markdown views), **WebView** (`URL`, `width`, `height`, `alignment`: an embedded web
  page), **MinVersionForceView** (`minVersion` with a `view`: shows the view only when the app is that version or
  newer, otherwise "Requires a newer Sileo").
- Forms: a button action that opens a form fetched from a URL (`DepictionFormViewController`, kept to the form's
  host).

**Who ships them.** The default paid repos (Chariz, Havoc) and most modern repos give tweaks a `SileoDepiction:`.

**iFizBox.** `screens/depiction.js` renders every class in the list above except forms, in the iOS 6 style, as plain
DOM. ReviewView is one grouped cell; MinVersionForceView renders its inner `view` (Sileo's version numbers mean
nothing for iFizBox). Markdown is parsed locally and raw HTML goes through an allowlist. Unknown classes are skipped,
as in Sileo. Forms stay out (they post user input to the repo).

## Featured banners (`sileo-featured.json`)

**Sileo.** Each repo's `sileo-featured.json` (`FeaturedBannersView`: `itemSize`, `itemCornerRadius`, `banners: [{url,
title, package, hideShadow}]`) sits at the top of that repo's page. Sileo's own Featured tab loads
`featured-<device>.json` from its store URL. That one uses more classes (`FeaturedPackageView`, `FeaturedHeaderView`,
`FeaturedButtonView`, …) and only Sileo's own server serves it. Zebra shows featured repos on Home
(`ZBFeaturedCollectionViewCell`).

**iFizBox.** `core/featured.js` parses `FeaturedBannersView`, shows banners on the source page, and shows a few from
each source on Home. Sileo's store-wide featured file is Sileo's own curation, not a repo format, so iFizBox leaves
it out.

## Payment Provider API (paid packages)

**The flow** (both apps; Sileo `Backend/Payment Manager`, Zebra `Tabs/Sources/Helpers/ZBPaymentVendor.m`):
1. Read the endpoint from `<repo>/payment_endpoint`. `GET info` gives the vendor's name and icon.
2. Sign in by opening `authenticate?udid=&model=` in `ASWebAuthenticationSession` with callback scheme
   **`sileo`**. The callback carries `token` and `payment_secret`.
3. Keychain:
   - Sileo: the token is a plain item. The secret uses `.userPresence` with `WhenUnlockedThisDeviceOnly`, read
     after an `LAContext` check.
   - Zebra: the secret is stored under `<repo>payment`. When reading it fails with `LAErrorPasscodeNotSet`, Zebra
     carries on without the secret ("payment secret only applies when a passcode is set").
4. Get the price: `POST package/<id>/info`. Zebra tries **GET first** and falls back to POST for vendors that
   reject GET (`supportsGETPackageInfo`).
5. Buy: `POST package/<id>/purchase`. Status 0 means done. Status 1 means open `url` (https only) in another auth
   session, then treat the package as bought.
6. Download: `POST package/<id>/authorize_download` returns `{url}`. Download that URL as usual.
7. A reply with `invalidate: true` drops the saved token.

**What each sends.**
- Sileo puts `udid` and `device` in **every** POST and adds `token`, plus `payment_secret` for a purchase.
  `authorize_download` adds `version`, `repo` and **`architecture`**.
- Zebra sends `token` (`"none"` when signed out), `udid` and `device` everywhere. Its purchase also sends
  `payment_secret` (`null` when there is none). Its `authorize_download` adds `version`, **`architecture`** and
  `repo`.

**iFizBox** (`core/payment.js buildRequest`, `native/Sources/Paid.swift`): the same flow and the same `sileo`
callback. Every POST but sign-out carries `udid` and `device`, and `authorize_download` the package's
`architecture`, so a vendor serving rootful and rootless .debs picks the right one. Keychain items use
`.userPresence`/`WhenPasscodeSetThisDeviceOnly` and fall back to plain items when the phone has no passcode.
Havoc's and Chariz's payment APIs know packages only by lowercase ID, so requests to havoc.app and chariz.com
lowercase it in the path (`core/payment.js`); other vendors get it as listed, and the apt package ID stays as
listed everywhere else.

**Checking it on a phone:**
- After a purchase, the vendor's purchase and download records show the right device.
- `authorize_download` returns an **arm64 (rootless)** .deb. Check the downloaded control file's `Architecture:`.
- On a phone with no passcode, sign-in and purchase still work (Zebra's `PasscodeNotSet` case).
- An expired token produces `invalidate` and asks the user to sign in again.

## Queue and dependency resolution

**Zebra** (`Database/ZBDependencyResolver.m`, `Queue/`):
- It has its own resolver. It walks Depends with `|` alternatives in order and version comparisons, counts Provides,
  and queues conflicting installed packages for removal.
- Queue rows show why each one is there: "Dependency of X" / "Removed by X" in a subtitle, or red "Issues" when a
  dependency can't be met.
- Tapping a row with problems opens an alert listing them. Confirm stays greyed out while any row has issues.
- Queue types: Install, Remove, Reinstall, Upgrade, Downgrade, plus Dependency and Conflict for rows the resolver
  added.

**Sileo** (`Backend/Dependency Resolver`, `UI/DownloadsViewController`) runs libapt's resolver. Its queue sheet
lists installs, upgrades, removals and the packages they pull in, plus apt's broken packages as errors. Confirm
stays off while there are errors.

**iFizBox.** Confirm runs real `apt-get -s` over the whole queue and shows Modifications. "Cannot Comply" carries
one-sentence explanations with actions (Add Chariz, Remove Y), with apt's output underneath. Zebra's "Dependency of
X" subtitle isn't there: `apt-get -s` doesn't say which package pulled what in, though `core/deps.js` has a `via`
chain the reason could come from.

## Source refresh speed and caching

- **Sileo** (`Backend/Repo Manager/RepoManager.swift`): Release first, with a timeout per repo, and repos refresh
  concurrently. It tries `Packages.zst`, `.xz`, `.lzma`, `.bz2`, `.gz`, then plain, in that order. It keeps a hash
  cache (`RepoHashCache.json`) of each Packages file's sha256 from the Release, and when a new Release lists the same
  hash it doesn't download Packages again. On a normal launch it refreshes only repos older than **3 hours**
  (`repoRequiresUpdate`). Pull to refresh forces all of them.
- **Zebra** (`Downloads/ZBDownloadManager.m`): `If-Modified-Since` from the saved file's date, parsed into SQLite.
- **iFizBox:**
  - Release fingerprint (`core/health.js fingerprint`): an unchanged Release skips Packages, the same idea as
    Sileo's hash cache.
  - ETag/Last-Modified kept in IndexedDB (`core/cache.js`).
  - 8 repos at a time with a 20 s timeout each (`REFRESH_CONCURRENCY`, `REFRESH_TIMEOUT`).
  - Parsing runs in a worker.

## Other features

| Feature | Sileo / Zebra | iFizBox |
|---|---|---|
| **Wish List** | Both (`Wish List Manager`, `ZBWishListTableViewController`): add a package from its page, then list them all on one page | Add to / Remove from Wish List on the package page, a Wish List page (`core/wishlist.js`); synced by the iFizBox Account |
| Hide by author | Zebra Filters | Settings > General > Blocked: packages and authors |
| Installed sort | Sileo: Name / Install Date / Size | Cydia's User / Expert / Recent (Recent needs the jailbreak app's install dates) |
| Installed files | Zebra `ZBInstalledFilesTableViewController` | none for dpkg packages |
| News tab | Zebra: r/jailbreak via api.getzbra.com; Sileo: recently updated packages | Changes tab (recent updates, Cydia's); no Reddit feed |
| Community sources | Zebra: a list per jailbreak | `core/recommended.js` |
| Telemetry | Sileo: Canister ingest of installed packages | none |
