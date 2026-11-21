# F359: sign every app up front, install This iPhone rows together

## What changed

- `web/app/core/apprun.js`
  - `createAppRun` takes `parallel` (default 1, so other callers behave as before). `installLaneStart(rows, {parallel,
    local})` picks the row the install lane starts now: with nothing at iOS, the next signed row (`installLaneNext`,
    so iFizBox itself still goes last and alone). With rows already at iOS, one more starts only when every one of
    them is `here` (copying or installing on This iPhone, so its route is settled: no LocalDevVPN wait or iOS prompt
    can be up), the next row is a This iPhone row too (`local(row)`, not iFizBox, not a helper row, not a Try Again),
    and fewer than `parallel` are going. So rows join one at a time, each once the one before it starts copying:
    the first row settles the route (and any LocalDevVPN alert) alone, and a row that falls back to iOS's prompt
    holds the others. The run calls `pump()` when a row first reports "copying".
  - `HERE_PARALLEL = 3`.
  - Stall clocks: the shell signs one app at a time (`SignAhead.signer`), so with every app downloading at once a
    downloaded app waits for the signer with no progress of its own. While another row's signing moves, the clocks
    of rows that are downloaded (state downloading, fraction 1) start again; a stuck signer still fails them.
  - `runStatus`: with more than one row at iOS, "Copying N apps to iPhone" or "Installing N apps".
- `web/app/screens/apprun.js`: when the lanes have `local` (the sideload app's queue run, `screens/queue.js`), it
  passes `ahead: Infinity` (every app starts downloading and signing at once) and `parallel: HERE_PARALLEL`. The
  jailbreak app's helper run passes no `local`, so it is unchanged.
- `native/Sources/SignBridge.swift`: `HereLane`, a concurrent queue with 3 slots. `Sideload.installHere` runs on it
  instead of the serial `IDevice.queue`. Each `IDevice.install` already opens its own Session, staging path and Watch,
  so several can run at once. Over Tailscale it is one at a time: `Tailscale.beginInstall` / `endInstall` start and
  stop one node and relay for the whole app, and a second install ending would stop the first one's node. Each
  install first waits for whatever `IDevice.queue` is doing (`idevice.pair` holds it), as before.
- `web/app/core/apprun-parallel.test.js`: every app's signing starts before the first install; This iPhone rows
  overlap (each joins on the one before's copy, 3 at most, each its own Copying/Installing words, a free place goes
  to the next); prompt rows stay one at a time with the others Signed; a fallback to iOS's prompt and a Try Again
  hold the others; iFizBox's own row still waits for every other; stop, Retry and Cancel per row while rows copy
  together; the signer-wait stall clock.

## Decision: "all signed before the first install"

The brief asks for "sign every app up front" and a test "all signed before the first install". Read literally (the
install lane waits until every app is signed) that brings back B263, the user's own complaint from the same day: a
Re-sign All held every install until the last download finished. Unattended, so I picked the reading that fits both:
every app starts downloading and signing at once (no `ahead = 2` limit), and an app goes to install as soon as it is
signed, never waiting for another app's download. The test checks that every sign starts before the first install.
The existing B263 test still passes unchanged.

## Not verified

- **The 15 Pro run (3 apps over LocalDevVPN copying together)**: see below for what was tried.
- **Several RemotePairing tunnels at once on iOS 27**: each install opens its own tunnel (pair-verify, RSD). That
  iOS accepts 3 at once is only checked on the device; if it refuses, the second and third rows fail with the
  connect error. `HereLane.width = 1` would make it serial again in the shell.
- **Tailscale route**: installs wait in the shell one at a time, but the page still starts 3 rows; the 2nd and 3rd
  say "Installing" with no progress until their turn. Not tried on a phone (needs a tailnet login on the 15).
