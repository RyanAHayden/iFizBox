// B395: how often one queue of This iPhone installs may open Shortcuts for the Install Switch, so the phone can't go
// back and forth between the app and Shortcuts whatever Shortcuts does (missing, two of it, old, a stale error).
// Pure, no UIKit: native/sign/tests/sideload/main.swift tests it on Linux; LocalVPN keeps one, under its lock.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SwitchOpens {
    /// trip: the whole queue in one run; start, dataOff, end: an older Install Switch's own runs. `end` is also the
    /// retry of what a trip didn't put back.
    enum Run { case trip, start, dataOff, end }

    /// After a run that failed, no queue's start opens Shortcuts for this long (the next app of a run of installs is
    /// often a queue of its own). A check or a test the user taps ends it.
    static let rest: TimeInterval = 300
    /// One Add or Update check: the run, and one more.
    static let checkLimit = 2
    /// Before that one more when Shortcuts couldn't find it: just after Add Shortcut it can't for some seconds.
    static let checkWait: TimeInterval = 5

    private(set) var used: [Run] = [] // this queue's
    private(set) var failed = false // a run of this queue failed
    private var failedAt: Date?

    /// Takes the run when this queue may still open Shortcuts for it. At most one trip and an end, or a start, a
    /// dataOff and an end: each once, nothing but the end after a failed run.
    mutating func take(_ r: Run, now: Date = Date()) -> Bool {
        let ok: Bool
        switch r {
        case .trip, .start: ok = used.isEmpty && !failed && !resting(now)
        case .dataOff: ok = used == [.start] && !failed
        case .end: ok = !used.contains(.end)
        }
        if ok { used.append(r) }
        return ok
    }

    /// A run that never opened Shortcuts (the app wasn't in front) doesn't count.
    mutating func untake(_ r: Run) { if used.last == r { used.removeLast() } }

    /// `rest` false: only this queue (an older Install Switch ran the trip and did nothing: the next queue takes its
    /// own runs).
    mutating func fail(rest: Bool = true, now: Date = Date()) {
        failed = true
        if rest { failedAt = now }
    }

    func resting(_ now: Date = Date()) -> Bool {
        guard let t = failedAt else { return false }
        let s = now.timeIntervalSince(t)
        return s >= 0 && s < Self.rest
    }

    /// The queue before is over, its end included.
    mutating func newQueue() { used = []; failed = false }

    /// The user's own tap (Add's or Update's check passed, Test Install Switch): the failure is forgotten.
    mutating func forgive() { failedAt = nil; failed = false }

    /// Shortcuts has no Shortcut it can run by that name: nothing in it ran. An end would find none either.
    static func notFound(_ error: String?) -> Bool { error?.lowercased().contains("could not find the shortcut") ?? false }

    /// One Add or Update check run `i` (0: the first) that ended with `error`: what the second may be, nil for none.
    enum Again { case same, plain }
    static func again(_ i: Int, error: String?, actions: Bool) -> Again? {
        guard i + 1 < checkLimit, let e = error, e != "the Shortcut was canceled", !e.contains("didn't come back") else { return nil }
        if notFound(e) { return .same }
        return actions ? .plain : nil
    }
}
