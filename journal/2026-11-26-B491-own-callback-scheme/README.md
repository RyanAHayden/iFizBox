# B491: own callback scheme per copy

- New `native/sideload/vpn/App/CallbackScheme.swift`: `current()` = `ifizbox-<bundle id>` when this copy's Info.plist declares it, else `ifizbox`; `accepts()` takes `ifizbox` or this copy's own, never another copy's.
- Restore My VPN and Cellular Installs use both for x-success/x-error/x-cancel and the handlers.
- `Info-sideload.plist` declares `ifizbox-com.ryha.ifizbox`; the on-phone signer (`IPASigner.swift`) adds `ifizbox-<new id>` to an iFizBox copy (one that claims `ifizbox`) and drops a stale one from an earlier ID.
- The fallback to `ifizbox` when the scheme is not declared covers copies signed before this and website-signed copies.

## Not verified
- Not run on a phone: which copy iOS picks, and a real Shortcut callback on the own scheme, were not checked (no device in this run).
- The website signer (zsign WebAssembly) does not add the scheme; those copies use `ifizbox` as before.
- No Swift toolchain in this slot: the Swift changes were not compiled; the gate passed with the Swift tests skipped.
