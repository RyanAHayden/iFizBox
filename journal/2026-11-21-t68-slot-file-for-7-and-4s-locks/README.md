# T68: ui-7.sh and ui-4s.sh locks record the runner slot

## What I did
- `tools/ui-7.sh lock` and `tools/ui-4s.sh lock` now write `$AGENT_SLOT` to the lock's `slot` file, exactly as
  `tools/ui-15.sh` does (and remove it when the lock is taken outside a runner slot), so `tools/ui-release.sh`
  (runner `on_exit`) frees them by slot even after the worktree's branch has moved off `task/<ID>`.
- `tools/test_ui_release.py`: new test that, for each of the 15, 7 and 4S scripts, takes the lock with
  `AGENT_SLOT` set, checks the slot file, retakes without a slot (file gone), and checks `ui-release.sh` with only
  `AGENT_SLOT` frees it. Passes locally (6 tests).

## Tried and failed
Nothing.

## Not verified
- Not run on a real runner `on_exit` with a switched branch: the unit test covers the same script path with a
  temporary `XDG_RUNTIME_DIR`; no phone is needed since `lock` never talks to the device.
