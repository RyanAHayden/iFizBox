// Restore My VPN, the Shortcut that remembers the VPN that is on and sets it again after ours was used
// (tools/shortcuts/restore-vpn.plist): what its own actions (../../../intents/App/RestoreVPN.swift) tell the app about
// the run going on. Shortcuts' callback only brings the app back: it can be an earlier run's, and Set VPN often ends
// with error 2 after it has switched (R100b), so a back run is judged by the other VPN, off as it began, being up.
// Foundation only: ../tests/restore/main.swift tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum RestoreShortcut {
    /// Shortcuts names an added Shortcut after its file, and the app runs it by this name.
    static let shortcutName = "Restore My VPN"

    /// What a run does, the key of its input. store: remembers the current VPN; back: sets it; check: touches no VPN.
    enum Kind: String { case store, back, check }
    static func input(_ k: Kind) -> String { "{\"\(k.rawValue)\":1}" }

    /// The run going on: what its actions reported.
    struct Report: Equatable {
        var kind: Kind
        var remembered = false // store: there was a current VPN, and it is kept
        var restoring = false // back: a VPN was kept, and Set VPN comes next
        var finished = false // the Shortcut got to its end; not in a back run whose Set VPN failed, switched or not
    }

    private static let lock = NSLock()
    private static var current: Report? // guarded by lock
    private static var leftAt: Date? // guarded by lock
    /// A run ended here before its Shortcut did may still report: none begins before this is over, or that would count
    /// for the new one.
    static let settle: TimeInterval = 10

    static var report: Report? { lock.lock(); defer { lock.unlock() }; return current }

    /// Before the Shortcut is opened with input(kind). The refusal's code, or nil once the run has begun.
    /// busy: another run goes on or just ended early; no_vpn: no other VPN is up to remember (with ours the current one,
    /// Shortcuts would keep ours); on_already: another VPN is up, nothing to bring back; vpn_on: ours is up, which a back run would turn off.
    static func begin(_ k: Kind, vpnUp: Bool, otherVPN: Bool, now: Date = Date()) -> String? {
        if k == .store, !otherVPN { return "no_vpn" }
        if k == .back, otherVPN { return "on_already" }
        if k != .check, vpnUp { return "vpn_on" }
        lock.lock(); defer { lock.unlock() }
        if current != nil { return "busy" }
        if let t = leftAt, (0..<settle).contains(now.timeIntervalSince(t)) { return "busy" }
        current = Report(kind: k)
        return nil
    }

    /// The run is judged: what it reports from now on is ignored. Every begun run ends here. Answers what it reported.
    @discardableResult
    static func end(now: Date = Date()) -> Report? {
        lock.lock(); defer { lock.unlock() }
        let c = current
        if let c { leftAt = c.finished ? nil : now }
        current = nil
        return c
    }

    // ---- The actions. With no run going on (opened by hand, or the app was killed) each does nothing.

    static func remembered() { change { if $0.kind == .store { $0.remembered = true } } }
    static func restoring() { change { if $0.kind == .back { $0.restoring = true } } }
    static func finished() { change { $0.finished = true } }

    // ---- Opening it, and judging a run

    /// Shortcuts' x-callback link that runs it. `back` makes the link Shortcuts opens for ok, error or cancel.
    static func runURL(_ k: Kind, back: (String) -> String) -> URL? {
        var c = URLComponents()
        c.scheme = "shortcuts"; c.host = "x-callback-url"; c.path = "/run-shortcut"
        c.queryItems = [URLQueryItem(name: "name", value: shortcutName), URLQueryItem(name: "input", value: "text"),
                        URLQueryItem(name: "text", value: input(k)), URLQueryItem(name: "x-success", value: back("ok")),
                        URLQueryItem(name: "x-error", value: back("error")), URLQueryItem(name: "x-cancel", value: back("cancel"))]
        return c.url
    }

    /// failed: not_run (back in front without our actions: no Shortcut of that name, Allow refused, an older one),
    /// no_vpn (store: Shortcuts found no current VPN), not_stored (back: no VPN kept yet), not_back (back: Set VPN came,
    /// the other VPN didn't), no_end (store: kept, but the end didn't come), no_return (the app didn't come back, as
    /// behind Shortcuts' "VPN not found" alert). The text is what Shortcuts said.
    enum Verdict: Equatable { case wait, ok, failed(String, String?) }
    /// Back in front, for our own actions to say it runs.
    static let grace: TimeInterval = 3
    static let endLimit: TimeInterval = 10 // back in front after one of them, until the end or the other VPN is up
    static let runLimit: TimeInterval = 60 // out of the app: the first run waits for the user's Allow

    /// A run so far. `front`: seconds back in front after Shortcuts. Both count the time the process ran, so a run that
    /// iOS suspended behind Shortcuts goes on from where it was. `otherVPN`: another VPN is up now. `said`, the
    /// callback's error, is only told on.
    static func verdict(_ r: Report?, elapsed: TimeInterval, front: TimeInterval, otherVPN: Bool, said: String?) -> Verdict {
        if let r {
            switch r.kind {
            case .check: if r.finished { return .ok }
            case .store:
                if r.finished { return r.remembered ? .ok : .failed("no_vpn", nil) }
            case .back:
                if otherVPN { return .ok } // it was off as the run began
                if r.finished, !r.restoring { return .failed("not_stored", nil) }
            }
            if r.remembered || r.restoring {
                if front >= endLimit { return .failed(r.kind == .back ? "not_back" : "no_end", said) }
                return front == 0 && elapsed >= runLimit ? .failed("no_return", nil) : .wait
            }
        }
        if front >= grace { return .failed("not_run", said) }
        return front == 0 && elapsed >= runLimit ? .failed("no_return", nil) : .wait
    }

    private static func change(_ f: (inout Report) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard var c = current, !c.finished else { return }
        f(&c)
        current = c
    }
}
