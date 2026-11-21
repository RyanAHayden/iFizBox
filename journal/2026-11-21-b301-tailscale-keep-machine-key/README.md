# B301: Tailscale Sign Out keeps the machine key

## What changed

`native/sideload/tailscale/Tailscale.swift`: Sign Out still logs the node out (`TSLogout`), stops it, and drops
{name, keyExpiry} (UserDefaults and Keychain). It no longer deletes the whole node state: `Tailscale.forget()` now
calls `TailscaleKeep.keepMachineKeyOnly()`, which rewrites `tailscaled.state` (or, if the container has none, the
Keychain's copy) as `{"_machinekey": …}` only, in the container and in the Keychain. Only when there is no machine
key to keep does the state directory go, as before.

Why the machine key alone: in tailscale.com v1.104.7 (go.mod's pin), `LocalBackend.Logout` sets the prefs logged
out, calls the control server's logout, then `pm.DeleteProfile` (the login's profile, which holds the node key).
It never touches `ipn.MachineKeyStateKey` ("_machinekey"); only `ResetAuth` clears that. So after a successful
Logout the store already holds just the machine key plus profile bookkeeping; cutting it to the one entry also
covers a Logout that failed (no network), where the profile and node key would otherwise linger. The FileStore is
a JSON map of key to base64 bytes (`ipn/store/stores.go`), so the entry is copied as its string unchanged.

A Sign In with the same machine key is the same machine to the control server, so the tailnet's
`ifizbox-on-iphone-4` (expired after R57's Sign Out) should come back instead of a new `-5`.

A reinstall after Sign Out still restores the kept machine key (restoreState), and restoreDefaults doesn't treat
the app as signed in, since the node account is gone.

Tests: `test_tailscale_keep.py` gains `test_sign_out_keeps_the_machine_key` (order: kept before anything is
deleted, state dir only removed when nothing was kept, Logout and stop before forget).

## Not verified

- **On a phone**: the Swift was not run. Sign Out then Sign In on the iPhone 15 Pro needs the owner to type the
  Tailscale login (R57 is waiting on that); the check is that the tailnet's machine count stays at five and the
  app's node comes back under its old name.
- **The control server's side** (same machine key after a logout = same machine) is Tailscale's documented
  behaviour for `tailscale logout` / `tailscale up`, not seen for this app.
- **Swift build**: only through `tools/check.sh` (the gate builds the sideload app).
