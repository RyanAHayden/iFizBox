// Runs Cellular Installs while installs wait on cellular data, and puts cellular data back after a run that failed or
// an app that was killed (CellularShortcut.swift has the rules, CellularShortcutBridge.swift opens it and follows it).
//   cellular.run      for installs waiting in LocalVPN.waitOffCellular: replies once the Shortcut ended:
//                     {ok, error, text, putBack}. error: not_waiting (no install waits), vpn_off, busy, ran_out (the
//                     waits ended with installs not connected), or CellularShortcut.Verdict's code. putBack, after a
//                     failed run: null (cellular data was on), "on" ({"on":1} turned it on) or "failed" (it didn't)
//   cellular.putBack  {putBack}: what the put-back at launch did, once it is over; null when there was none. Told once
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Network

enum CellularRun {
    /// Set from just before Shortcuts is opened until cellular data is known to be on: an app killed in between
    /// finds it at its next launch.
    /// A file, not UserDefaults, as RestoreBack's: after iFizBox's own update the new copy sometimes read UserDefaults'
    /// value from before the close, and would open Shortcuts unasked at its launch.
    private static let owedFile = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ifizbox.cellular.owed")
    private static var owed: Bool {
        get { (try? Data(contentsOf: owedFile)) == Data("1".utf8) }
        set {
            try? FileManager.default.createDirectory(at: owedFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            do { try Data((newValue ? "1" : "0").utf8).write(to: owedFile, options: .atomic) } catch { log("owed not kept: \(error)") }
        }
    }

    static func register(_ b: Bridge) {
        launched()
        b.on("cellular.run") { c in
            if let e = CellularShortcutBridge.refusal { return Apt.reply(c, nil, e) }
            DispatchQueue.global(qos: .userInitiated).async {
                let r = run()
                let n: (String?) -> Any = { $0 ?? NSNull() }
                Apt.reply(c, ["ok": r.error == nil, "error": n(r.error), "text": n(r.text), "putBack": n(r.putBack)], nil)
            }
        }
        b.on("cellular.putBack") { c in
            DispatchQueue.global(qos: .utility).async {
                launch.wait()
                lock.lock(); let o = outcome; outcome = nil; lock.unlock()
                Apt.reply(c, ["putBack": (o as Any?) ?? NSNull()], nil)
            }
        }
    }

    private static func log(_ s: String) { LocalVPN.log("\(CellularShortcut.shortcutName): \(s)") }

    /// Blocking.
    private static func run() -> (error: String?, text: String?, putBack: String?) {
        guard LocalVPN.waitsOnCellular() else { return ("not_waiting", nil, nil) }
        guard LocalVPN.connectedNow() else { return ("vpn_off", nil, nil) }
        lock.lock(); let atLaunch = launching; lock.unlock()
        guard !atLaunch, CellularShortcut.begin(.run, vpnUp: true) else { return ("busy", nil, nil) }
        log("run begins; path: \(LocalVPN.Path.described())")
        CellularShortcut.releaseIfNone() // the last install ended meanwhile
        owed = true
        let verdict = CellularShortcutBridge.drive(.run) { r, s in
            CellularShortcut.runVerdict(r, elapsed: s.elapsed, front: s.front, quiet: s.quiet, said: s.said)
        }
        guard case .failed(let code, let text) = verdict else {
            owed = false
            log("run over: \(CellularShortcut.report?.turns ?? 0) turns; path: \(LocalVPN.Path.described())")
            return (nil, nil, nil)
        }
        log("run failed: \(code)\(text.map { " (\($0))" } ?? "")")
        if code == "ran_out" { // it got to its end: cellular data is on
            owed = false
            return (code, nil, nil)
        }
        _ = CellularShortcut.giveUp()
        let back = putBack()
        if back != "failed" { owed = false } // else the next launch tries once more
        return (code, text, back)
    }

    // ---- Putting cellular data back

    static let onLimit: TimeInterval = 2 // for the first reading
    /// Cellular up for this long: the data is on, and a Shortcut given up or left by a killed app isn't about to turn
    /// it off any more.
    static let onSteady: TimeInterval = CellularShortcut.settle

    private static let lock = NSLock()
    private static let launch = DispatchGroup() // the put-back at launch
    private static var launching = false // guarded by lock: that goes on
    private static var outcome: String? // guarded by lock: what it did, until the page asked

    private static func launched() {
        guard owed, CellularShortcutBridge.available else { return }
        log("the app ended during a run")
        lock.lock(); launching = true; lock.unlock()
        DispatchQueue.global(qos: .utility).async(group: launch) {
            let o = putBack()
            owed = false // failed as well: the page says to turn it on, and no later launch opens Shortcuts again
            lock.lock(); outcome = o; launching = false; lock.unlock()
        }
    }

    /// Blocking, however long until the app is in front: cellular data on again. nil when it was on already.
    private static func putBack() -> String? {
        func nothing() -> Bool {
            guard dataOn() else { return false }
            log("cellular data is on: nothing to put back")
            return true
        }
        if nothing() { return nil }
        while true {
            if !CellularShortcutBridge.active() {
                while !CellularShortcutBridge.active() { Thread.sleep(forTimeInterval: 0.25) }
                if nothing() { return nil } // it came on while the app was away
                continue
            }
            if CellularShortcut.begin(.on, vpnUp: false) { break }
            Thread.sleep(forTimeInterval: 0.25) // a check goes on
        }
        let verdict = CellularShortcutBridge.drive(.on) { r, s in
            CellularShortcut.verdict(r, elapsed: s.elapsed, front: s.front, said: s.said)
        }
        guard case .failed(let code, let text) = verdict else {
            log("cellular data put back")
            return "on"
        }
        _ = CellularShortcut.giveUp()
        log("cellular data not put back: \(code)\(text.map { " (\($0))" } ?? "")")
        return "failed"
    }

    /// Cellular data works now, whatever else is joined. No signal reads as off.
    private static func dataOn() -> Bool {
        let m = NWPathMonitor(requiredInterfaceType: .cellular)
        m.start(queue: DispatchQueue(label: "ifizbox.cellular.data"))
        defer { m.cancel() }
        var steady = 0.0, waited = 0.0
        while waited < onLimit || steady > 0 {
            Thread.sleep(forTimeInterval: 0.1)
            waited += 0.1
            steady = m.currentPath.status == .satisfied ? steady + 0.1 : 0
            if steady >= onSteady { return true }
        }
        return false
    }
}
