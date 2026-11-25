# B457 cellular owed mark: a file

Done: CellularRun's owed mark moved from UserDefaults key `ifizbox.cellular.owed` to a file of the same name in
Application Support, written atomically as "1" or "0", the same code shape as `RestoreBack.owed` (F438a). UserDefaults'
last write before iFizBox's own update can be lost, so the new copy's launch could find the mark still set and, when cellular
data reads off, open Shortcuts unasked to turn it on. The old UserDefaults value is deliberately not read or migrated,
since it is the value that may be stale. Cost: a mark left by a run killed in an older build is not put back after
updating.
Test: test_vpn.py test_run checks the file, not UserDefaults. Nothing tried failed.
No release note: the fault was found by reading code and was never seen by users.

**Not verified**: a real cellular own update on a phone. It needs cellular data off at the launch after the update, and
the fault was never reproduced. The same file approach held in 10 of 10 F438a1 runs for RestoreBack on the iPhone 15 Pro.
