// The Restore My VPN Shortcut, in the sideload app (native/sideload/vpn/App/RestoreShortcutBridge.swift). Each rejects
// with "missing: …" while the signed Shortcut isn't in the build, "unavailable: …" where it can't run.

// The share sheet, where Shortcuts opens Add Shortcut: {opened}.
export const addRestoreShortcut = (native) => native.call("restore.add");
// Remembers the VPN that is on, while another VPN is up: {ok, error, text}.
export const rememberVPN = (native) => native.call("restore.store");
// Turns the remembered VPN on again, once ours is off; ok only when another VPN is up: {ok, error, text}.
export const bringBackVPN = (native) => native.call("restore.back");
