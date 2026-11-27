// Restore My VPN: when the back run (RestoreShortcutBridge) is due. LocalVPN says when ours takes another VPN's place;
// once nothing uses ours any more, the Shortcut sets that VPN again, once for the whole queue: unasked while the app
// stayed in front, else only after the person's answer.
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
        var left = false        // the app was left or killed since ours took that VPN's place
        var never = false       // the person said: no more asking on a return
        var going: Bool { waiting || down == false } // an install or ours goes on
    }

    /// drop: nothing to bring back any more. later: look again in a few seconds, the app still in front. back: run it.
    /// ask: run it only when the person says so.
    enum Step: Equatable { case drop, later, onReturn, back, ask }

    static func step(_ n: Now) -> Step {
        if n.never, n.left { return .drop }
        if n.waiting || n.down != true { return n.front ? .later : .onReturn }
        if n.otherVPN || n.replaced { return .drop }
        guard n.front else { return .onReturn }
        guard n.active, n.online else { return .later }
        return n.left ? .ask : .back
    }

    /// How long ours stays on after the last install or connection ends: `linger`, so the next of a queue or a
    /// reconnect finds it on; none after a Cancel, so the back run isn't held by a VPN nothing will use.
    static func offAfter(linger: TimeInterval, cancelled: Bool) -> TimeInterval { cancelled ? 0 : linger }

    /// A look that comes while one waits for its next turn (`later`, `ask`): that turn runs now. The look comes from
    /// ours going off, the app's return or an answer, so what the wait was for may be over.
    static func wakes(_ s: Step) -> Bool { s == .later || s == .ask }

    /// A Cellular Installs trip to Shortcuts doesn't count as leaving, unless the app stayed away this long after it
    /// (Home from Shortcuts is no second notice).
    static let tripLimit: TimeInterval = 60
    static func leftOnTrip(_ away: TimeInterval) -> Bool { !(0..<tripLimit).contains(away) }

    /// The person's answer while it is held.
    enum Answer: String { case on, notNow, never }

    /// What an answer does to it, by the step it is at. run: the back run now. approve: they said yes, but not now: it
    /// runs unasked once it can, the app in front until then. keep: still to be answered.
    enum Outcome: Equatable { case run, approve, drop, keep }
    static func outcome(_ a: Answer, _ s: Step) -> Outcome {
        guard a == .on else { return .drop }
        switch s {
        case .ask, .back: return .run
        case .later: return .approve
        case .drop: return .drop
        case .onReturn: return .keep
        }
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
