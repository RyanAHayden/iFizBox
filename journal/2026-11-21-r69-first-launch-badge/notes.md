# R69: the icon badge on the first launch after installing a new .deb, iPhone 7

**Result: not reproduced, no B needed for now.** Six first launches right after `apt-get install` of an iFizBox
.deb (five with the real page, one with the test page), covering every condition R65's case had (a version
change, so the page's `updated()` sends 0 then the count; the old badge left by the daemon's posted "N Upgrades"
notification; the page's count above the daemon's), and on every one SpringBoard's badge store held the new count
at the first read, 8-10 s after the launch (7 s after the tap on the test page). The brief's two suspects don't show
on this phone: badge permission read `authorized` (badges on) on a first launch after an install, and no set waited
for SpringBoard to re-read the app: each was in place by the first read, well inside the minute R65 watched. How
fast within those 8-10 s on a first launch wasn't timed (2 s for a set made later, in a running app). R65's one
stuck launch stays unexplained (see the end).

Permission on the real-page runs (1, 3-6) wasn't read directly, but iOS only puts a badge on an app's icon with
badge permission, and each set landed. For the same reason no build with a log line in `applyIcon` was needed:
the store changing to the page's count after its `app.badge` shows `applyIcon` ran and iOS took it. A log line
only helps on a launch that sticks, and none did.

Chromium can't show a Home Screen badge or iOS's notification permission, so this needed the phone.

## How the icon was read: SpringBoard's own store

iOS 15 keeps each app's Home Screen badge in FrontBoard's `/var/mobile/Library/FrontBoard/applicationState.db`
(sqlite, readable as mobile): table `kvs`, key `SBApplicationBadgeKey` (via `key_tab`), the app via
`application_identifier_tab`; the value is the badge as text (`1`), no row when bare. It follows a set within 2 s
(page `app.badge 5` → `5`), the daemon's sets too (badge-only set of 0 → no row; posted notification with badge 2 →
`2`), and it matched the icon on screen where I looked (`r69-home1`: store 1, icon 1). The phone has no sqlite3, so
`harness/icon-badge.sh` copies the db (with -wal/-shm) to the desktop and queries it there; it also prints the
prefs mtime (when the page's `app.badge` last changed `ifizbox.updates.pageCount`). This reads the icon without a
screenshot or the ui-7.sh lock, and to the second.

## Tools (in `harness/`)

- `index.html`: stands in for `web/index.html` (same app origin, so `ifizboxNative` is there): shows
  `app.notifyStatus` on load, buttons send `app.badge` 5 / 3 / 0. Read by screenshot.
- `icon-badge.sh`: the store read above.
- `testrepo.sh`: two throwaway packages (`com.ryha.r69a`, `com.ryha.r69b`) at 1.0, 1.1 of each in a flat `file:`
  repo, so the daemon counts 2 upgrades with no tunnel; `clean` removes it all. For the page to count them too, the
  same repo was served from the desktop (`python3 -m http.server 8869` on 127.0.0.1 + `ssh -R 8869`) and added to
  `ifizbox.sources` as a `Trusted: yes` stanza.
- Builds: `native/build.sh deb` from this branch, 0.19.1-4020, then 0.19.1-4021 after a journal commit (a new
  build number, so a real version change both ways: 4020 → 4021 and a downgrade 4021 → 4020).

## Runs

Each: Home, the app closed (kill by pid on the phone), the icon read, `apt-get install` of a .deb, the icon read,
`ifizbox://changes`, the icon read 8-10 s later (and again 20 s later on two). The phone started on 0.19.1-3972.

| | Install | Icon before, set by | Page's count | Icon after first launch |
|---|---|---|---|---|
| 1 | 3972 → 4020 (version change) | 3, the page (harness) | 1 | 1 |
| 2 | none (plain relaunch, control) | bare, daemon badge-only set of 0 | 1 | 1 |
| 3 | 4020 reinstall | bare, daemon badge-only set of 0 | 1 | 1 |
| 4 | 4020 reinstall | 2, daemon's posted notification | 1 | 1 |
| 5 | 4020 → 4021 (version change) | 2, daemon's posted notification | 1 | 1 (also 1 at +30 s; on screen too) |
| 6 | 4021 → 4020 (version change) | 2, daemon's posted notification | 3 (test repo seen by the page) | 3 (also at +30 s) |
| 7 | 4020 → 4021, harness as the first page | 3 | (harness) | `notifyStatus`: authorized, badges true; `app.badge 5` → 5 |

Run 6 is R65's case in full: a version change, the daemon's notification badge left on the icon, and the page's
count higher than it (R65: 1 → 2; here 2 → 3).

Side checks:
- In one process, a set equal to the last one the app made still lands after the daemon changed the icon in
  between (page 3 → daemon 0 → page 3: icon 3). So the app side keeps no stale "last badge" that skips a set.
- `VersionedSectionInfo.plist` (BulletinBoard's per-app notification settings) kept its 2026-11-20 03:32 mtime
  through the first five installs (read before run 7): an apt-get install of iFizBox does not reset its notification permission.
- The postinst reloads the upgrade daemon (RunAtLoad), but a run only sets the badge when a check is due (6 h) or
  forced; R65's daemon state was 3 h old at its install, so the daemon didn't reset the icon there either.

## What tried and didn't work

- `awk` and `plutil` aren't on the phone; the store read goes through scp + the desktop's sqlite3.
- `DeliveredNotifications.plist` and `Library.plist` under `/var/mobile/Library/UserNotifications/` hold the
  delivered notifications and the app → folder map, not the badge: the badge is FrontBoard's.

## What R65's stuck launch could still be

Not reproduced, so these are guesses, none tested:
- R65 upgraded from 0.19.1-3913, a build from before B310 (not at hand to repeat). The first launch runs the new
  build's code, and R65 saw `pageCount 2` stored, so `app.badge` did run; what happened after it in iOS is unknown.
- The icon on screen lagging SpringBoard's store after uicache (SpringBoard rebuilds the icon view): R65 read
  the icon from screenshots only, so it can't tell "not set" from "set but not redrawn". The store read above
  tells them apart if it happens again.

No B filed: nothing to fix without a repro, and the next time it shows, `harness/icon-badge.sh` right after the
first launch says at once whether iOS took the set (store = page's count, icon stale) or dropped it (store old).

## Phone state after

Real `index.html` back (md5 f107d9b2…, the 4021 build's), `ifizbox.sources` restored (md5 ff348f0f…), test
packages removed, `r69test.list` gone, no apt lists left for the test sources, `upgrades.state` back to its
content before the test (`last 1795295177`), work files in `/var/mobile` deleted, http server and tunnel stopped
by pid, ui-7.sh lock released. Icon 1, Changes 1 (OpenTennis). 0.19.1-4021 (this branch: main plus this journal)
stays installed, newer than the 3972 that was there.

## Not verified

- An upgrade from 0.19.1-3913 (R65's starting build): its .deb wasn't at hand, and the first launch runs the new
  build's code anyway; only its WebKit storage and `ifizbox.lastVersion` carry over, which runs 1, 5 and 6 cover.
- A notification that has sat for hours before the install (R65's was from 12:17, the install 15:24): mine were
  seconds to a minute old.
- An install from inside the app (the helper's deferred uicache): the brief's case was `apt-get install` over ssh.
- That the store and the screen agree on every run: checked on screen once (run 5); the other runs read the
  store only, so "set but not redrawn" isn't ruled out for them (it would still not be a lost set).
- How long a set takes to reach the store on a first launch after an install: only that it was there by the first
  read, 8-10 s after the launch.
- A build with a log line in `applyIcon`: not made, as no launch stuck (see the top).
