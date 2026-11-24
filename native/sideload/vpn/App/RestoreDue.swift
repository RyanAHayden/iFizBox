// Restore My VPN: when the back run (RestoreShortcutBridge) is due. LocalVPN says when ours takes another VPN's place;
// once nothing uses ours any more, the Shortcut sets that VPN again, once for the whole queue.
// Foundation only: ../tests/restoredue/main.swift tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum RestoreDue {
    /// What is so now, as far as a look needs it.
    struct Now {
        var front = true        // the app is in front (a menu over it counts)
        var active = true       // and takes touches: iOS opens Shortcuts only then
        var waiting = false     // an install waits for the app, or an app is being downloaded, signed or installed
        var online = true       // a network: iOS starts no VPN without one
        var otherVPN = false    // another VPN is up
        var down: Bool? = true  // ours: nothing uses it and iOS says it is off; nil: not read
        var replaced = false    // another VPN has Settings > VPN's checkmark since
    }

    /// drop: nothing to bring back any more. later: look again in a few seconds, the app still in front. back: run it.
    enum Step: Equatable { case drop, later, onReturn, back }

    static func step(_ n: Now) -> Step {
        if n.waiting || n.down != true { return n.front ? .later : .onReturn }
        if n.otherVPN || n.replaced { return .drop }
        guard n.front else { return .onReturn }
        return n.active && n.online ? .back : .later
    }

    /// After a back run: still due. Only when Shortcuts wasn't opened at all; a run that was, however it ended, was the
    /// queue's one. not_opened with the app active means there is no Shortcuts to open.
    static func stillDue(_ error: String?, active: Bool) -> Bool {
        switch error {
        case "busy", "vpn_on": return true
        case "not_opened": return !active
        default: return false
        }
    }
}
