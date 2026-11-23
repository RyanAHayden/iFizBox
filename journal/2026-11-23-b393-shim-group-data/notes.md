# B393: shim group data brought in at launch

## Change

- `native/groupfix/groupfix.m`, `bringIn`, called from `ownFolder` in the constructor for every group (see docs/signing.md, App Groups).
- Why at launch, not on first ask: whether the app ran before is only known at the first launch. A later ask would take a fresh install for one that ran, and two threads could race.
- Consequence: the legacy copy also runs at launch for every group.
- `copyMissing` now skips top-level items named after the original groups. Without this, the shim's own subfolder in the profile group would be copied into itself by the legacy copy.
- Spec review: fixed retry after out of space; fixed a retry that could merge the old suite into one that was not empty. Left the eager copy at launch (reason above), the marker and the log line (the copy needs them).

## Phone check (iPhone 15 Pro)

- `resignprobe` with the real `zxPluginsInject.dylib` (from a RyukGram IPA) injected with zsign before an ad hoc sign. Website signer, identity A. Scripts: `phone.sh` and `probe-edit.py` in this folder. Run at scratch paths.
- `probe-edit.py` gives each store its own filename and label and puts the fix's log in the report. `phone.sh` waits 12 s before each re-sign so preferences are written out.
- First run was inconclusive, not a reproduction. Main's dylib also showed grp-file "kept": the probe's real-file marker (same filename, same second) reached it through the legacy copy, via the shim's folder for the profile group.
- Second run:
  - nofix sign writes markers (file in `<profile group>/group.org.example.probe.original`, and a suite).
  - Main's dylib: file NEW (lost). Suite is another app's 2026-11-20 marker (junk).
  - Uninstall, nofix again, this branch's dylib: file and suite kept. Log: "brought in from before the group fix: group.org.example.probe.original folder 3, suite 1". Second launch and second re-sign kept both, with no second log line.
  - Fresh install with the shim's folder still in the profile group: file and suite NEW, "ran before no", nothing brought in.
  - The file kept in the branch step was written by the earlier install of the same probe (the shim folder in a profile group outlives an uninstall). The suite was written by this one.
- Slip: the first wait for the phone lock used a relative path from the wrong folder, so it never could get it.
- Phone left: `probe.zx` uninstalled. Probe markers remain in the profile group's shim folders, and `probe.*` keychain items remain (an uninstall keeps them).

## Relation to B392

- B392 (unmerged, worktree s2, commit e63cd7e8) changes the same `groupfix.m`. The text was placed to merge cleanly as far as possible (not tried). The binary dylib and `.source-sha256` will conflict: run `native/groupfix/build.sh` after the merge.
- Until B392, a fresh RyukGram reads as "ran before" (its initialisers write preferences), so it may bring in what an earlier install's shim left.

## Not verified

- Real RyukGram 453 / Instagram on the phone (probe with the real shim instead).
- The native signer on the phone (same dylib file).
- Launch time with a large group folder (real Instagram size).
- The `.copying` retry paths: crash, before first unlock, out of space.
- Another shim (one giving a folder in the app's own container).
- Upstream zxPluginsInject keeping the suite in the shim folder's `Library/Preferences` (not the place seen in B390).
- A shim that loads after the group fix.
- Another fix dylib (SideDrop's) in the same app.
- Extensions keep the old place.
- Apps that already lost sight of their data under an earlier fix (own folder exists) are not recovered.
