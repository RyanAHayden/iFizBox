# F418: Restore Shortcut source

## Did
- Split into F418 (this), F418a (bridge), F418b (signing and phone). F419 now waits for all three.
- The plist is built from `ref/shortcuts-signed/restore-app.plist`, with Restore My VPN's own intents in place of
  Cellular Installs' and `Nothing` appended last, so the run's last action returns nothing.
- Intents in `native/intents/App/RestoreVPN.swift` (Remembered VPN, Restoring VPN, Finish Restore My VPN), in the
  sideload IPA's metadata only. They report to `RestoreShortcut.swift`.
- Tests in their own files (`test_restoreshortcut.py`, `tests/restore/main.swift`), so parallel slots don't collide.

## Decisions
- Own actions rather than Cellular Installs' OpenForInstall and FinishInstalls: those would count for a cellular run.
- Restoring VPN comes before Set VPN, because Set VPN's error 2 ends the run before any later action.
- x-callback is kept only to bring the app back. It never judges a run.
- Back begins only with `otherVPN` off (`on_already` otherwise) and passes as soon as it is up, whatever was reported.
- A run ending without Finish (error 2, or judged before it) makes the next `busy` for 10 s: kept, back runs once a queue.
- Finish doesn't say which run it is: one that comes over 10 s late (a left Allow answered) would count for the next run.
  Kept: telling runs apart needs an action with a parameter, untried in a signed file.
- Store is refused without another VPN up, or with ours up. Get Current VPN could keep ours; R100b's proxy test
  stored ours.
- A run ended before its Shortcut blocks a new one for 10 s (settle), so late reports don't count.
- The intents live in `native/intents/App`. The path `native/sideload/intents` from the old task doesn't exist.
- No release note: nothing on screen runs it yet.

## Tried
- ssh to the MBA timed out several times.

## Not verified
- The plist on a phone, or signed (MBA offline).
- That the actions report while the app is behind Shortcuts.
- That `otherVPN` false positives don't occur (a utun with an IPv4 of something else).
- That x-callback runs don't prompt with the new plist. The final `Nothing` is only tested by R100b, in an edited duplicate.
- The actions' Allow prompt.

All of these are in F418b.
