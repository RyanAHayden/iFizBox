# R97: why This iPhone installs never overlapped in R90

## Finding

R90 installed through Install IPAs > Manage > Sign and Install. That path never reaches the run that has the parallel lane:

- `signMany` (web/app/screens/myipas.js) is a plain `for` loop: for each picked IPA it `await`s `install(...)` (installFromLibrary: one signing.install call, one progress HUD "Signing X (1 of 3)") and stops at the first IPA that does not install. By its own comment: "each picked IPA signed and installed in turn".
- It does not use `createAppRun`, `installLaneStart` or `HERE_PARALLEL`, and native `HereLane` (width 3) only ever sees one call at a time. So B418's overlapping `LocalVPN.up()` calls cannot happen from that button, whatever the size (40 or 250 MB) or the route. R90's "never overlapped" is the code working as written, not a lane bug.
- The parallel lane is the app run (web/app/screens/queue.js -> runAppRun, `parallel: HERE_PARALLEL`, only when the lanes carry `local`, i.e. the stored route is This iPhone). It is fed by Install on an app's page, or on an IPA's own page in My IPAs (`queueLibraryInstall`, F241: queues a `libraryJob`, then Confirm).

## Checked and fine (reading + tests)

- `installLaneStart` (web/app/core/apprun.js): a second row starts only when every row with iOS has `here` set, the next row is a This iPhone row, and fewer than `parallel` are going. `here` is set by the first "connecting" progress, which openPrepared (web/app/signing/queue.js) emits before it calls signing.open, so the second row joins at once; progressOf then calls `pump()`. `node --test web/app/core/apprun-parallel.test.js`: 7 pass, including 3 rows at once and "3 at most".
- Native `HereLane.run` (SignBridge.swift) is a concurrent queue with a 3-slot semaphore; `SignAhead.open` (signing.open) hands each call to `Sideload.installHere` -> `HereLane.run` -> `IDevice.install`, whose `LocalVPN.begin`/`up()` serialise on `startLock` (B418). Nothing there serialises whole installs.
- Rows stay one at a time (by design) when: the route is not This iPhone (`local` false: a Signing Server route, an iOS prompt row), a row is Try Again, the row is iFizBox itself, or a row is still settling its route (`here` false, e.g. an alert up, or on cellular waiting for Airplane Mode: `allSigned` hold).

## Not verified

- A device run with 2+ rows copying at once, and the log lines (one "enabling the configuration", no "stale"). The iPhone 15 Pro UI lock was held by R93 (`tools/ui-15.sh lock R97`: "locked by R93") and this brief's scope is a report, so I did not wait for it. Filed as its own task below.
- That the app run really overlaps on the phone: only the unit tests and the reading above.

## Filed

- F416: Sign and Install (My IPAs Manage) goes through the app run instead of `signMany`, so the picked IPAs install together on This iPhone.
- R98: the device run of the app run with 3 My IPAs queued (route: this note), checking the VPN log.
