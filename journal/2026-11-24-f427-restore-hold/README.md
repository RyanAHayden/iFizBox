# F427: Restore My VPN waits for an answer once the app was left

## What I did
- `native/sideload/vpn/App/RestoreDue.swift`: the steps (drop, later, onReturn, back, ask) and what each answer does.
- `native/sideload/vpn/App/RestoreBack.swift`: the left flag, the question (`restore.due`), `never`
  (UserDefaults `ifizbox.vpn.backNever`), the answer, and the 2 s look while asking.
- `native/sideload/vpn/App/RestoreShortcutBridge.swift`: the `restore.due` stream and `restore.answer`.
- `native/sideload/vpn/App/LocalVPN.swift`: changed alongside.
- `native/sideload/vpn/tests/restoredue/main.swift`, `native/sideload/vpn/test_restoredue.py`: the rules' tests.
- `docs/sideload.md`: the Restore My VPN paragraph and the bridge paragraph.
- `GLOSSARY.md`: the Restore My VPN entry.

## Decisions
- Leaving at any time after a run was owed counts as left, also during the queue. A run owed with the app in front
  the whole time is unasked, as before.
- A Cellular Installs trip to Shortcuts is not leaving: it is the app's own switch (`CellularShortcut.running`, and back within 60 s: Home from Shortcuts sends no second background notice).
- Owed at launch means held: `left` starts true in memory, since a kill can't be told from a leave.
- The page gets a stream (`restore.due`) rather than polling status.
- The look goes on every 2 s while asking, so the question is withdrawn if another VPN comes up.
- `never` is kept in UserDefaults; turning Restore My VPN off clears it.
- release-notes/F427.md says only that Shortcuts no longer opens by itself; F428's covers the question.

## Not verified
- Nothing run on the iPhone 15 Pro. The rules were checked on Linux; the shell wiring was read as text and compiled.
- The `restore.due` stream reaching the page.
- Until F428's page lands nothing answers a held run, so it waits.
- A Cellular Installs trip not counting as left, on a phone.

## Spec review
- The first version exempted on `CellularShortcut.report == nil`, which stays set after a passed run, so leaving would no longer have counted. Fixed, and the 60 s limit added.
- `on` answering `later` during an install was kept: it is needed for an install starting while it waits.

## Tried
- A gate run with no page code calling the new handlers failed `test_bridge_contract`: the two wrappers
  (`watchRestoreDue`, `answerRestore`) are in `web/app/core/restoreshortcut.js`, with a test. No screen uses them yet.
