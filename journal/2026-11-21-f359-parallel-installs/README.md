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

## Spec review

A fresh subagent read the diff and brief. Fixed: the first test resolved every sign before checking, so it could
not fail; it now resolves only A and checks that B to E were already signing before A's install. Kept, with the
reasons above: Tailscale capped at 1 in the shell; the stall-clock change (needed for `ahead: Infinity`); the one-line
`Sideload.swift` change (needed to use the lane). Prompt rows still go on once the row before ends, which on the
prompt route is when iOS has fetched the whole IPA (B200's handoff), the "answered" point the brief means.

## On the 15 Pro (tools/ui-15.sh, this build installed by the rig)

Three test IPAs (Tiny.app as `com.ryha.ifizbox.f359a/b/c`, 40 MB each, made in the scratchpad and put in My IPAs
over AFC) run through `runAppRun` with `phoneLanes` from Web Inspector, route set to Signing Server for the run:
- row words sampled every 250 ms: 0.3 s "Signing | Downloading | Downloading" (all three started at once; B and C
  waited for the shell's one signer), 0.5 s "Tap Install on the iOS prompt | Signed | Downloading", 0.8 s
  "Tap Install on the iOS prompt | Signed | Signed". One iOS prompt (F359 A), the other two Signed and waiting.
- iOS's Cancel, then the run's Cancel: all three rows Cancelled, the run ended. IPAs removed from Documents and the
  route put back to This iPhone afterwards.

## Not verified

- **The 15 Pro run (3 apps over LocalDevVPN copying together)**: the 15 has no LocalDevVPN app (installing it
  needs the owner's Apple ID), and its iFizBox is signed out of Tailscale (`idevice.status`: localDevVPN false,
  tailscale.signedIn false; only the owner can log in, see memory). So the This iPhone route can't run there now,
  and over Tailscale the shell goes one at a time by design. The overlap is checked by `apprun-parallel.test.js`
  only, and the shell's lane by the build compiling.
- **Several RemotePairing tunnels at once on iOS 27**: each install opens its own tunnel (pair-verify, RSD). That
  iOS accepts 3 at once is only checked on the device; if it refuses, the second and third rows fail with the
  connect error. `HereLane.width = 1` would make it serial again in the shell.
- **Tailscale route**: installs wait in the shell one at a time, but the page still starts 3 rows; the 2nd and 3rd
  say "Installing" with no progress until their turn. Not tried on a phone (needs a tailnet login on the 15).
- Filed R66 (low, after F359): the LocalDevVPN run on the 15 once the owner installs LocalDevVPN.
