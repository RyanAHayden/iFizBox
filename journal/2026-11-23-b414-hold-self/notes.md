# B414: iFizBox held open through a run that installs iFizBox

## What I did
- A queue run that installs iFizBox itself now holds the app open from its start: the app calls `hold-self on` (app.holdSelf in native/Sources/Bridge.swift, which also stops Replaced's watcher). The helper (native/helper/held.h, `hold-self`) records `<pid> <start time>` in `<prefix>/var/lib/ifizbox/held`, 0644.
- While the record is there and the app lives, native/deb/postinst's background `uicache -p` keeps waiting after the run has ended, with no time limit; the Restart SpringBoard button then waits for the tap instead of the app closing itself.
- The helper (native/helper/main.c) accepts the app's calls once dpkg has replaced its binary, when the path it ran from no longer exists: pid and start time must both match. `userspace-reboot` runs `uicache -p` first, since the reboot ends the postinst's job.
- The app lets go (`hold-self off`) when the run ends clean on Close iFizBox, or when the Running page closes (button, Close, Cancel, Later) (web/app/screens/queuerun.js). A record left behind is cleared by the next dpkg-running verb from another process.
- native/helper/README.md: the "Installing iFizBox over itself" paragraph now describes the hold; the synopsis and verb table list `hold-self on|off`.
- release-notes/B414.md: one sentence for users. The package-only Confirm fix is left out: F407 has not shipped (it is not in v0.26.0), so no user has seen that bug.

## Found on the way
- Once dpkg replaces the binary, the old app is refused by the helper: exit 77, "can't identify the calling process" (B84's journal saw it too). Hence the record, and the identity check that accepts the app by pid and start time.
- A Confirm with only packages passed `apps: []` to runQueueRun (F407), so `deps.apps.start` was not a function and no package-only run could start on the jailbreak app. Fixed in web/app/screens/queue.js (one line, commit c2245615), with a test in web/app/screens/queue-confirm.test.js. The phone check could not run without it.
- A wrong guess first: I thought the phone had a queued app.

## Phone check (iPhone 7)
Not run in Chromium: it needs the real shell, helper and uicache.
- Setup: 0.27.0-5067 (this branch) running. Upgraded to 5068 plus a test tweak, from a throwaway repo served through ssh -R. web/app/screens/queue.js on the phone was patched by hand with the one-line fix before the run. The test source needs an unsigned allowance: `apt-get update` with `Acquire::AllowInsecureRepositories=true`.
- The page said Restart SpringBoard and was still there 25+ s later. The held file matched the app's pid, and the postinst's job was alive, waiting. (`ps` needs sudo to see it.)
- Tapped Restart SpringBoard: SpringBoard pid 1727 -> 17417, the app was gone, the postinst's job was gone, 5068 opened. Both packages installed ok.
- `dpkg --audit` shows only the baseline (palera1n's virtual packages without md5sums). `dpkg/updates` is empty.

## iFizBox alone on the phone
5069 (installed over ssh) upgraded in the app to 5070, nothing else queued: the app closed itself once the run ended,
the hold file was gone, no postinst or uicache job left, `install ok installed` 5070, dpkg audit at the baseline,
`dpkg/updates` empty. The hold file the restart run left behind (its app was killed by the respring) was cleared.

Cleaned up: the test source, its lists, the test tweak and the temp files are off the phone; iFizBox 5070 (this branch)
stays; lock given back, server and tunnel stopped.

`git reset`-free note: an empty commit, "build number", is on the branch only to give the second build a higher one.

## Not verified
- The userspace reboot and Reload SpringBoard on the phone. A userspace reboot may lose the palera1n jailbreak, so these are covered by unit tests only. Reload uses the same respring verb as Restart.
- That LaunchServices' own record names the new version. Only that uicache's job ended.
- iOS 16+ and other jailbreaks.
