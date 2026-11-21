# R65: B310's icon badge after a queue run, on the iPhone 7

**Result: passes.** Queue an upgrade, run it from Confirm on the Installed tab, press Home as the run ends,
no relaunch: the Home Screen icon badge dropped from 2 to 1 (the one upgrade still waiting). Run 1 is the
brief's check (Home the moment dpkg had the package installed, icon seen at 2 before). Run 2 was an extra,
earlier press (Home while dpkg was still unpacking, before the run's end); it also ended at 1, but I didn't
look at the icon before it.
Chromium can't show a Home Screen badge, so this needed the phone.

## Setup

- The phone had 0.19.1-3913, a build from before B310 (`badgeAfterRun` missing from its `web/app.js`). Built
  `native/build.sh deb` from this branch (main with B310, 0.19.1-3972), installed it with `apt-get install`
  under the ui-7.sh lock, and checked `grep badgeAfterRun` in the installed `web/app.js` before driving.
- A throwaway package `com.ryha.r65test`: 1.0 installed with `dpkg -i` (built on the phone with `dpkg-deb`),
  1.1 in a flat repo served from the scratchpad (`python3 -m http.server 8865` on 127.0.0.1 + `ssh -R 8865`),
  added to `/var/jb/etc/apt/sources.list.d/ifizbox.sources` as a deb822 stanza with `Trusted: yes`.
- Changes then showed 2 upgrades (OpenTennis 1.8.6, already pending on the phone, and R65 Badge Test 1.1),
  so the right badge after the run is 1, not 0: a run that leaves one upgrade checks that the count is the
  real one less what ran, not just a clear.

## Runs

The Home press was one ssh call on the phone: `phonectl tap` on Confirm, then a loop over
`dpkg-query -W com.ryha.r65test` every 50-100 ms, `phonectl home` the moment it changed.

| | Home pressed when | Shell got the count (prefs mtime) | Icon before | Icon after (3 s and 10 s) |
|---|---|---|---|---|
| Run 1 | dpkg said `1.1 install ok installed` (0.6 s after Confirm), 15:31:16 | 15:31:16.43 | 2 | 1 |
| Run 2 | dpkg said `1.1 install ok unpacked`, before the run ended, 15:33:41.51 | 15:33:41.57 (60 ms after Home) | 2 (Changes) | 1 |

- Both: Modify > Upgrade on the package page (Confirm opened), Continue Queuing, Installed tab, Queue >
  Confirm from there.
- `ifizbox.updates.pageCount` in `/var/jb/var/mobile/Library/Preferences/com.ryha.ifizbox.plist` (what the
  last `app.badge` sent, Notifications.swift) read 1 after run 1.
- The daemon did not do it: `upgrades.state` was last written at 12:17, hours before the runs, and nothing
  else sets the badge.
- Run 2's last `app.badge` reached the shell 60 ms after Home, so the page still ran in that moment. Which
  call sent it (B310's quick count at the run's end, or the recount after it) I can't tell from the outside;
  either way the icon ended right. With a 572-byte package, run 1's Home press and the run's end are under a
  second apart, so "right as it ends" and "just after it ended" are hard to tell apart here.
- After both, the run page showed "1 installed"; Changes showed 1 (OpenTennis).

## Side finding: the shell path on its own

To rule out the shell before the runs, a test page swapped in for `web/index.html` (same app origin, backup
and md5 restored afterwards) called `app.badge {count: 5}`: it replied with no error and the icon showed 5.
Relaunching the real page then set it back to 2. So `UIApplication.applicationIconBadgeNumber` (the iOS 15
branch of `Notifications.applyIcon`) works from this jailbreak app.

## Side finding: first launch after installing the .deb

On the first launch right after `apt-get install` of the new .deb, Changes counted 2 and the shell stored
`pageCount 2` (15:24:46), but the icon kept its old 1 (left by the daemon at 12:17) through two looks over a
minute, including a relaunch from the icon. After the test-page check above and one more launch, the real
page's 2 did reach the icon. I don't know why that first launch's count didn't show; it is not in B310's
path (it happened before any run). Filed as a low research task (see below).

## Cleanup

Removed `com.ryha.r65test`, restored `ifizbox.sources` from its backup, deleted the two apt list files for
127.0.0.1:8865 and the `/var/mobile/r65` work folder, stopped the http server and the tunnel (by their pids),
refreshed Changes (back to 1 upgrade), went Home and gave back the ui-7.sh lock. This branch's .deb
(0.19.1-3972) stays installed, as the phone doc asks (newer than what was there).

## Filed

- R12 (low): the first launch after installing the .deb left the icon at the old count (above).

## Not verified

- The icon at 2 right before run 2: I saw Changes at 2 (after Refresh picked up the outside downgrade to 1.0)
  but didn't go Home to look, to keep the queue steps short. Run 1 did show the icon at 2 before.
- The Installed-tab hop in run 2 wasn't screenshotted (same taps as run 1, which was); Confirm opened with
  the one Upgrade row both times.
- A slower run (a real package with a bigger download, several packages, a failure): only a 572-byte package
  was run. The quick count goes out at the run's end either way; a long run only moves when that is.
- Confirm's run from other tabs, and the console run (Roll Back, paid installs): not run; the brief named
  Confirm on the Installed tab.
- Lite on the iPhone 15 Pro: not in this brief.
