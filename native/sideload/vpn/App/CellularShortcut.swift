// Cellular Installs, the one Shortcut that turns cellular data off around the connects of This iPhone installs and on
// again (tools/shortcuts/cellular-installs.plist): what its own actions (../../../intents/App/CellularInstalls.swift)
// tell the app about the run going on. A run is judged by them alone: Shortcuts' callback can be an earlier run's.
// Foundation only: ../tests/main.swift tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum CellularShortcut {
    /// Shortcuts names an added Shortcut after its file, and the app runs it by this name (tools/shortcuts/sign.sh).
    static let shortcutName = "Cellular Installs"
    /// Shortcuts cuts an action off at about 30 s, so a Wait for Install turn is shorter; the Shortcut has this many.
    static let waitStep: TimeInterval = 20
    static let waitTurns = 15

    /// What a run does, the key of its input. run: all of it; on: cellular data on only; check: touches no data.
    enum Kind: String { case run, on, check }
    static func input(_ k: Kind) -> String { "{\"\(k.rawValue)\":1}" }

    /// The run going on, or the last one: what its actions reported.
    struct Report: Equatable {
        var kind: Kind
        var opened = false // Open for Install ran: the app is in front, and in `run` cellular data went off before it
        var turns = 0 // Wait for Install turns that ended
        var released = false // the waits may end: every waiting install is connected, or the run was given up
        var finished = false // the Shortcut got to its end: in `run` and `on`, cellular data is on again
        /// Every wait ended with the installs not connected: the Shortcut goes on to its end by itself.
        var ranOut: Bool { kind == .run && turns >= waitTurns && !released }
        /// What proves this kind of run worked.
        var ok: Bool { finished && opened && (kind != .check || turns > 0) }
    }

    private static let lock = NSLock()
    private static var current: Report? // guarded by lock
    private static var givenUpAt: Date? // guarded by lock
    /// After a run was given up its Shortcut may still go on; its waits end at once, so it is over by then. No run or
    /// check begins before, or its actions would count for the new one. `on` may: either end means data is on again.
    static let settle: TimeInterval = 10

    static var report: Report? { lock.lock(); defer { lock.unlock() }; return current }

    /// Before the Shortcut is opened with input(kind). False while an earlier run hasn't finished or been given up, for
    /// `settle` after one was given up, and for `run` without the built-in VPN up: iOS starts no VPN once data is off, and keeps one that is up.
    static func begin(_ k: Kind, vpnUp: Bool, now: Date = Date()) -> Bool {
        guard k != .run || vpnUp else { return false }
        lock.lock(); defer { lock.unlock() }
        if let c = current, !c.finished { return false }
        if k != .on, let t = givenUpAt, (0..<settle).contains(now.timeIntervalSince(t)) { return false }
        current = Report(kind: k)
        return true
    }

    /// Every waiting install is connected: Wait for Install ends and the Shortcut turns cellular data on.
    static func release() { change { $0.released = true } }

    /// The run failed or didn't come back: its waits end, and what it reports while no run is going on
    /// is ignored. Answers what it reported.
    static func giveUp() -> Report? {
        lock.lock(); defer { lock.unlock() }
        let c = current
        if let c, !c.finished { givenUpAt = Date() }
        current = nil
        return c
    }

    // ---- The actions. With no run going on (opened by hand, or the app was killed) each does nothing and the waits
    // end at once, so a Shortcut still running goes on to turn cellular data on.

    static func opened() { change { $0.opened = true } }
    static func waiting() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return current.map { $0.kind == .run && !$0.released && !$0.ranOut && !$0.finished } ?? false
    }
    static func waited() { change { $0.turns += 1 } }
    static func finished() { change { if $0.opened { $0.finished = true } } } // not opened: an earlier run's end

    private static func change(_ f: (inout Report) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard var c = current, !c.finished else { return }
        f(&c)
        current = c
    }
}
