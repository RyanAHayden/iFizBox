// The Cellular Installs Shortcut, in the sideload app (native/sideload/vpn/App/CellularShortcutBridge.swift).

// {available, bundled, added}
export const shortcutStatus = (native) => native.call("cellular.status");
// The share sheet, where Shortcuts opens Add Shortcut: {opened}. Only a check says it was added.
export const addShortcut = (native) => native.call("cellular.add");
// {ok, error, text, status}; touches no cellular data.
export const checkShortcut = (native) => native.call("cellular.check");
