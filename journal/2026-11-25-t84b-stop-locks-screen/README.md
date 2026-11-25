# T84b: Stop locks the phone's screen

## Done
- `stop()` in `tools/remote-15.py`: when the phone is free or held as USER, it starts a detached process
  (own session, `timeout 200`): free → `ui lock USER` (a task that got there first wins, nothing else happens),
  then `ui unlock USER`, which is the phone script's tidy (closes apps, locks the screen, frees the UI lock).
  Task-held: nothing touched. Then exit 0 at once, so the Tools page's 4 s group kill does not cut the tidy.
- The "already dark stays dark" rule is the phone scripts' own tidy (the 15 wakes a dark screen first; the 7 and 4S
  press Home before the side button). No change was needed in ui-15/7/4s.sh.
- Unreachable phone: the scripts free the lock anyway; Stop has already ended.
- Tests (`tools/test_remote_15.py`): stub script, free / USER-held / task-held for the 15 and 7 (4S for held cases),
  and a slow failing unlock that outlives the stopped process.

## Not verified
- On each real phone: stop with the screen on and off (the phones were not used in this unattended run).
