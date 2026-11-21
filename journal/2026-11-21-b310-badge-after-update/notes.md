# B310: icon badge drops as soon as a run ends

## What was wrong

- Jailbreak app: `createUpgradeNotices` (web/app/settings.js) sends a count above 0 to the icon on every count,
  but sends 0 only while the Changes tab is on screen (F65's "goes once the Changes tab shows no upgrades"). A
  queue run started from Confirm (Installed tab, or any tab) that upgraded everything left the icon at its old
  number until Changes was opened, or the app relaunched (B158's first-launch clear).
- Both builds: after a package run, the count only came from `catalog.reloadInstalled` -> `catalog.onChange` ->
  Changes' `badge()`, which reads dpkg's status into the worker and counts every source again. Sent to the
  background right after the run, WKWebView stops running the page and that count never goes out.

## What changed

- `screens/changes.js`: `badge()` keeps what it last counted (`lastCounted`). New `badgeAfterRun(ids)`: takes the
  run's packages off that count and sets it at once (synchronously), through `ctx.badgeAfterRun`; it also marks the
  next real count (the one `reloadInstalled` triggers) to go through `ctx.badgeAfterRun` too, so a 0 the quick
  count missed (a dependency that was also an upgrade) still reaches the icon.
- `app.js`: `ctx.badgeAfterRun(tab, n)` = `setBadge` plus `upgradeNotices.updated()` when n is 0, which sends
  `app.badge {count: 0}` on any tab (and takes N5's delivered notification away, Notifications.swift).
- `screens/queue.js`: `countAfterRun(ids)`; the console run calls it when apt went through (all its jobs), Confirm's
  run (queuerun.js `onEnd`) with the rows that installed.
- Lite: app updates and re-signs already recount per app (B264 `recountBadge`), and the sideload page mirrors
  every count to the icon, 0 included; the shell drops a handed-off row while the page sleeps (B264). Nothing
  more was needed there; the after-run path also works in the sideload build (same ctx).

## Native side, looked at, not changed

- `Notifications.swift`: every icon badge goes through one ordered setter (B158 `setIcon`); `app.badge` also stores
  the page's count for the sideload background check. Nothing stale there.
- `native/daemon/main.m` / `auto.c`: each hourly run counts again from dpkg's status and `apt-get -s dist-upgrade`,
  so after a run it counts what's left; it keeps no badge number of its own between runs. Not a stale source.

## Checks

- `node --test web/app/screens/badge-after-update.test.js`: the quick count goes out synchronously with the new
  number (0 included), the following recount goes through the after-run setter, later ones don't; jailbreak
  `createUpgradeNotices` + the app.js glue send `app.badge 0` on the Installed tab, a plain 0 off Changes still
  doesn't (F65 kept); the wiring in app.js and queue.js.
- Neighbouring tests: changes-recount, badge-count, settings.

## Spec review

- Fixed: the after-run mark could stay set if the recount after a run failed, sending a later ordinary 0 off
  Changes to the icon (against F65). It now lasts `AFTER_RUN_MS` (2 min) at most; tested.
- Kept: `countAfterRun` goes through `import("./changes.js")`. Changes is already loaded by then (its init runs after
  the first page), so this resolves within microtasks, before `reloadInstalled`'s worker round trip. That is not a
  window where the page can be suspended.
- Kept: Confirm's run (queuerun.js) calls `onEnd` after `backend.markAuto` (one helper call, only when apt pulled
  packages in) and `runLogs.add`. queuerun.js isn't this task's file; the delay is one bridge round trip at most.
- queue.js isn't in the brief's file list, but the run-end calls have to sit there (two added lines).

## Not verified

- The real Home Screen icon on the iPhone 7 after a run (update, go Home without relaunching). Chromium can't show
  a Home Screen badge, so the brief's phone step applies, but it needs a fresh .deb of this branch on the 7 (other
  slots overwrite it), a package with a pending upgrade there, and the run itself; I judged the cost too high
  for a change that is entirely in the page: the native `app.badge` path it calls is the one B158 already checked
  on the device, and the new call goes out synchronously at the end of the run, which the node test shows.
- Filed R65 for the iPhone 7 check.
- Lite on the 15 Pro: not run, for the same reason (no native change; B264 covers the re-sign/update path).
