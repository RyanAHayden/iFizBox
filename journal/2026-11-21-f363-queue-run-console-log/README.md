# F363 Confirm's queue run kept in Console Logs from the first line

## What I did

- `web/app/screens/queuerun.js` runQueue: each pass starts its Console Logs entry with `runLogs.start` (at the pass's
  start, or at its first line if one comes earlier), every log line goes to the handle's `line()` as it comes, and the
  pass's end calls `set({ title })` (names known by then) and `end({ code, cancelled, finish, text })`, replacing the
  old `runLogs.add` at the end.
- A retry pass (Retry All, or a failed row's tap after the run ended) gets its own entry, holding only that pass's lines.
  Before, every pass's `add` held the whole log so far; the decision: one entry per pass reads as one run each, and the
  earlier pass's lines are in its own entry. A retry tapped while a pass still runs joins that pass, as before.
- A cancelled pass now ends its entry as Cancelled (`cancelled: true`), where `add` saved it as Failed/Completed by code.
- Tests: the fake `runLogs` is now the real `createRunLog` in memory; new tests for a run whose dpkg never ends (the
  entry reads running with its lines so far) and for a retry pass being its own entry.

## Tried that failed

Nothing.

## Not verified

- No device or browser run: the change is the log calls only, covered by the node tests over the real run log store;
  the phone check would only show the same entries in Console Logs.
