# R101a Tailscale route cleanup

## Dropped (`plan drop`)

- R64, R67, R71: node-naming and connection checks of the Tailscale install route (B301, F353, B316). C64 removed the route.
- F364: adds model names to `Tailscale.modelNames`. `native/sideload/tailscale/Tailscale.swift` is gone. The folder holds only an untracked `__pycache__` (no tracked files).
- R72: covered by F417 (On Cellular: Ask Each Time / Use Shortcut / Use Signing Server). The Tailscale and LocalDevVPN routes it tested are gone. Nothing is left over from R72.
- C67: C64 did the removal. The git grep check is below; no product code is left to remove, so C67 is closed.

## C67 git grep check (`git grep -il tailscale`, 196 files; 180 are journal/)

Outside journal/ and plan/ there are 14 files, none is the install route:

- Tests that assert the route is gone: `web/app/core/installroute.test.js`, `web/app/install-server-fallback-b375.test.js`, `web/app/screens/installroute-c64.test.js`, `installroute-f372.test.js`, `installroute-pair.test.js`, `why.test.js`. Keep them.
- `native/sideload/idevice/KeptRoute.swift` and `test_kept_route.py`: removes the old tailnet node's leftovers once on update, and keeps the Keychain service name `com.ryha.ifizbox.tailscale` so the saved route item survives. Keep.
- `web/app/source.json`: release notes of past versions mention Tailscale (history). Keep.
- `tools/remote-15.py`, `docs/iphone15.md`: the desktop's Tailscale IP serves the screen mirror for the 15 Pro. Dev tooling, not the app. Keep.
- `README.md`, `worker/README.md`, `worker/node.mjs`: `tailscale serve` as one way to give the signing server HTTPS. Still valid. Keep.

LocalDevVPN: only `docs/sideload.md` (explains that Feather uses it, iFizBox runs its own), the GLOSSARY.md avoid list, one source fixture and the absence tests.

## Not verified

none (read-only grep and plan checks; no device used).
