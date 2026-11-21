# F361 Console Logs: sideload runs too, kept while they run

## What changed

- `core/queue.js` createRunLog: `start(run)` saves the entry as running right away and hands back
  `{ line, set, end }`; each line is saved as it comes. Entries carry a `state`
  (running | done | failed | cancelled | stopped) and the page load's `session`; a running entry from an earlier
  load reads **Stopped** (`runState`). `runStatusText` gives the words (Running…, Completed, Failed (n), Cancelled,
  Stopped). Old entries without a state still read Completed / Failed.
- `core/signing.js` `loggedBridge(native, store)`: wraps the bridge so every sign/install call
  (signing.install, signing.open, signing.prepare, signing.resign, signing.resignAll, library.sign,
  library.install) is a console log from its first event: the shell's `{ log }` lines and one line per new phase
  (`{ phase }`, the native step?), then Done / Error / Cancelled. Idempotent; other calls untouched.
  `queue.js` registers `runLogs` with `logSideloadRuns` at load (it is in the startup closure, so no new modules).
  Wired in two places: `signing/common.js` `bridge()` (library.*, route.js signing.install, sign-ahead's
  prepare/open, selfupdate) and `callWithStall` (screens/queue.js signing.resign, signed-apps.js resignAll).
- `screens/ipa-install.js` runIpaConsole (jailbreak IPA install) and `screens/queue.js` runConsole (rollback, paid
  install, the old apply run) start their entry at the first line and end it when the run ends.
- Settings: the Console row shows in both builds (footer worded per build); Console Logs list and detail show the
  state, and redraw each second while something on the page is running.

## Checks

- `node --test` in web/app: all pass; new cases in `install-log.test.js` (a run that never ends, a run left by an
  earlier launch reads Stopped, the bridge wrapper's titles/lines/failures, runIpaConsole that never finishes,
  Settings row in sideload mode and the live redraw).
- Chromium (capture.mjs here, `--mode sideload`, APP_VERSION=99.0 to keep the update banner off): a fake
  signing.install that emits its lines and never answers. `logs-list.png`: "Install Delta · Running…";
  `logs-running.png`: the lines so far. The first try had the update banner over the top rows (fake version
  0.9.8); rerun with APP_VERSION=99.0.

## Not verified

- On a real phone (15 Pro / iPhone 7): not run. The change is web/app only and the fake bridge emits the same
  event shapes as Sideload.swift/MyIPAs.swift (`{log}`, `{phase, progress}`); per AGENTS.md the phone is only for
  what Chromium can't check.
- Stopped after a real kill: covered by the unit test (another session id over the same storage), not by killing
  the app.
- `screens/queuerun.js` (Confirm's F234 queue run) still writes its log only at the end: it is outside this
  task's files and its retry loop adds several entries per run; filed as F363.
- `signing.progress` (iOS's install log after a sign-ahead's signing.open) is not logged: it would add a third
  entry per app; the open's own entry ends when iOS has the link.
