# F418a: the Restore My VPN Shortcut bridge

## Did

- `native/sideload/vpn/App/RestoreShortcutBridge.swift`: the three calls, `restore.add`, `restore.store` and
  `restore.back`, and their runs.
- `LocalVPN.isDown` and `LocalVPN.savedStatus`, split out of `connectedNow`, which behaves as before.
- `web/app/core/restoreshortcut.js`: the page-side wrappers `addRestoreShortcut`, `rememberVPN` and `bringBackVPN`.
- `native/sideload/vpn/test_restorebridge.py` and `web/app/core/restoreshortcut.test.js`.

## Decisions

- Three calls only, no status or check call, since the task names three.
- The bridge reuses `CellularShortcutBridge.available` and `active()` for the same conditions as the cellular Shortcut.
- `store` and `back` also answer `missing` without the bundled file. Without it only a hand-added draft of that name
  could run.
- `active()` is awaited before `begin`, so what is up is read last. A not-in-front refusal does not cost the 10 s settle.
- `isDown` is false when the VPN state can't be read, or when an install holds it.
- An install that starts during a back run is not held off. The queue part decides when back runs.

## Tried

- Nothing failed.

## Not verified

- On a phone: nothing. No signed file exists until F418b, and every call answers `missing` until then. That covers
  the share sheet, the runs, the `otherVPN` judging and the callback.
