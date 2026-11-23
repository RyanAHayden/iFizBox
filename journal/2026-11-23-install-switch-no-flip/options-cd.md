# R78c: Install Switch options C and D on the iPhone 15 Pro

**Nothing was measured.** The iPhone 15 Pro's UI lock (`tools/ui-15.sh lock R78c`) was held by T76 (touched 11:23 to
11:24). Retries ran about 2 minutes, every 25 s, and the lock never came free. This is the same blocker as R78a and
R78b. No test of option C or D was run, and no result below is a hypothesis turned into a fact. The expectations stay
those in `notes.md` (options C and D sections).

## What this run settled

- The tests need more than the lock.
  - Option C needs a probe build of our share sheet with a row of a custom type that runs the Switch Shortcut. The
    measurements are whether Shortcuts' UI opens, whether the result returns to iFizBox, and the tap count (expect one
    extra tap).
  - Option D needs the shared-piece intents from R78a (Connect VPN, Wait for Install, and an intent with
    `openAppWhenRun`), plus hand-built Shortcuts. The measurements are:
    - does the Shortcut keep running once iFizBox is in front;
    - restore of data and VPN on install failure, on iFizBox kill, and on timeout.
  - Shortcuts has no try/catch, so an error in the middle of the run leaves cellular data off. The restore tests must
    show this directly, not assume the tail runs.
  - Stand-ins: Tailscale on for "another VPN up", Airplane Mode for "data off", as in R78b.
- A research task changes no product code, so the probe build must be its own task, filed separately.

## Not verified

Everything in C and D:

- C: Shortcuts UI presentation, return path, tap count, and the `x-error` path.
- D: Shortcut survival with iFizBox in front, the restore on install failure, on iFizBox kill, and on timeout, and the
  intent `openAppWhenRun` handoff.

Why: the phone lock was held by T76 for the whole run, and neither the probe build nor the hand-built Shortcuts exist.

## Next

- File the probe build as a separate T/F task. It carries the custom-type share row for C and the shared-piece intents
  (Connect VPN, Wait for Install, and the `openAppWhenRun` intent) for D.
- R78c stays open and is rerun when the lock is free and that probe exists.
- Expectations are unchanged from `notes.md`:
  - C: a brief Shortcuts presentation, not zero.
  - D: only worth building if the run survives iFizBox in front.
