# T79: AFC upload test switch

**Done:** `IDevice.upload` takes its chunk size and pipelined mode from `IDevice.copySwitch`. A debug build reads
the defaults `afcChunkMB` (1, 4 or 8) and `afcPipelined` (bool); a release build always gets 1 MB, one at a time.
Pipelined: the next chunk is read on a queue while the current write runs. The log gets a "test switch" line when
the switch is not the default, and the final "AFC: copied" line ends with this run's MB/s, chunk size and mode.

**Changed beyond the file:** `test_idevice.py` forbids `UserDefaults` in IDevice.swift (pairing stays out of it);
it now ignores the `#if DEBUG` block.

**Tried that failed:** first gate run, a typo (`let fh =try`); second, the UserDefaults test above.

**Not verified:** the gate result after the fix (rerun by `done`); no phone run, so pipelined speed and a resume
(`HereRecheck.resumeAt` now uses the active chunk size) with 4 or 8 MB chunks are untested.
