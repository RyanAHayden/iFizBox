# T84a Lock button for all three test phones

- Added `lock-button` to `tools/ui-4s.sh` (activator `libactivator.system.sleepbutton`, as its tidy does).
- `tools/remote-15.py`: `lock-button` command for 15, 7 and 4S, and a Lock button on the page.
- `runner.toml`: Lock button on the 15 and 4S cards (the 7 had one).
- `tools/test_remote_15.py`: each phone's page now runs `lock-button` through the fake script. 11 tests pass.

**Not verified**: pressing Lock once on each real phone (no phone was driven; the 4S's activator call is the one its tidy already uses).
