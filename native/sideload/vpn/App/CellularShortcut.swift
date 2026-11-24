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

    // ---- Opening it, and judging a check

    /// Shortcuts' x-callback link that runs it. `back` makes the link Shortcuts opens for ok, error or cancel.
    static func runURL(_ k: Kind, back: (String) -> String) -> URL? {
        var c = URLComponents()
        c.scheme = "shortcuts"; c.host = "x-callback-url"; c.path = "/run-shortcut"
        c.queryItems = [URLQueryItem(name: "name", value: shortcutName), URLQueryItem(name: "input", value: "text"),
                        URLQueryItem(name: "text", value: input(k)), URLQueryItem(name: "x-success", value: back("ok")),
                        URLQueryItem(name: "x-error", value: back("error")), URLQueryItem(name: "x-cancel", value: back("cancel"))]
        return c.url
    }

    /// failed: not_opened (Shortcuts didn't open), not_run (it ended without our Open: no Shortcut of that name, Allow
    /// refused, an older one), no_end (it opened the app but didn't finish), no_return (nothing came back in time),
    /// busy (check's own). The text is what Shortcuts said.
    enum Verdict: Equatable { case wait, ok, failed(String, String?) }
    /// Back in front, for our own actions to say it runs.
    static let grace: TimeInterval = 3
    static let endLimit: TimeInterval = 10 // back in front after Open ran, until Finish
    static let checkLimit: TimeInterval = 60 // the first run waits for the user's Allow

    /// A check so far. Its own actions decide, for iOS 27 gives a new run the callback of the one before; `said`, that
    /// callback's error, is only told on. `front`: seconds back in front after Shortcuts. Both count the time the
    /// process ran, so a check that iOS suspended behind Shortcuts goes on from where it was.
    static func verdict(_ r: Report?, elapsed: TimeInterval, front: TimeInterval, said: String?) -> Verdict {
        if r?.ok == true { return .ok }
        if r?.opened == true {
            if front >= endLimit || elapsed >= checkLimit { return .failed("no_end", said) }
        } else if front >= grace {
            return .failed("not_run", said)
        } else if elapsed >= checkLimit {
            return .failed("no_return", nil)
        }
        return .wait
    }

    /// A `run` so far: until Open ran as a check. After it, its actions report at least every waitStep, and at once when
    /// its waits may end; `quiet` is how long they haven't.
    /// failed: also ran_out (it got to its end, with installs not connected).
    static func runVerdict(_ r: Report?, elapsed: TimeInterval, front: TimeInterval, quiet: TimeInterval, said: String?) -> Verdict {
        guard let r, r.opened else { return verdict(r, elapsed: elapsed, front: front, said: said) }
        if r.ok { return r.ranOut ? .failed("ran_out", nil) : .ok }
        let limit = r.released || r.ranOut ? endLimit : waitStep + endLimit
        return quiet >= limit ? .failed("no_end", said) : .wait
    }

    /// A `run` has begun and hasn't finished or been given up.
    static var running: Bool { report.map { $0.kind == .run && !$0.finished } ?? false }

    // ---- The installs it waits for: each from before its wait off cellular until its connection is open, or it ended.

    private static var connecting = Set<UUID>() // guarded by lock

    static func connects(_ id: UUID) { lock.lock(); connecting.insert(id); lock.unlock() }
    /// The last one ends the waits of a run going on.
    static func connected(_ id: UUID) {
        lock.lock()
        let last = connecting.remove(id) != nil && connecting.isEmpty
        lock.unlock()
        if last { release() }
    }

    private static func change(_ f: (inout Report) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard var c = current, !c.finished else { return }
        f(&c)
        current = c
    }
}
