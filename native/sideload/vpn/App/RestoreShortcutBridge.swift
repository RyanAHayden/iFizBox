// Adds the Restore My VPN Shortcut and runs it (RestoreShortcut.swift has the run state and the rules).
//   restore.add    our signed Shortcut (web/shortcuts) in a share sheet, where Shortcuts opens it on Add Shortcut:
//                  {opened} when the sheet closes. Shortcuts never says it was added
//   restore.store  remembers the VPN that is on, while another VPN is up and ours is down: {ok, error, text}
//   restore.back   sets the remembered VPN, once ours is down; ok when another VPN is up: {ok, error, text}
//                  error: a begin refusal (RestoreShortcut.begin), RestoreShortcut.Verdict's code, or not_opened
// All three are refused with "unavailable: …" (the jailbreak app, another bundle ID, before iOS 16) or, while the signed
// file isn't in this build, "missing: …".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit

enum RestoreShortcutBridge {
    private static let host = "restore-vpn"
    private static let lock = NSLock()
    private static var runID: String? // guarded by lock: the run whose callback counts
    private static var called = false, said: String? // guarded by lock: its callback came, and the last one's error

    static func register(_ b: Bridge) {
        b.on("restore.add") { c in
            if let e = refusal { return Apt.reply(c, nil, e) }
            DispatchQueue.main.async { add(c) }
        }
        b.on("restore.store") { c in
            if let e = refusal { return Apt.reply(c, nil, e) }
            answer(c, .store)
        }
        b.on("restore.back") { c in
            if let e = refusal { return Apt.reply(c, nil, e) }
            answer(c, .back)
        }
    }

    /// Its actions are in the builds and under the bundle ID where Cellular Installs' are.
    private static var refusal: String? {
        guard CellularShortcutBridge.available else {
            return "unavailable: the \(RestoreShortcut.shortcutName) Shortcut needs iOS 16 and the sideload app under its own bundle ID"
        }
        return file == nil ? "missing: the \(RestoreShortcut.shortcutName) Shortcut isn't in this build" : nil
    }
    private static var file: URL? {
        Bundle.main.url(forResource: RestoreShortcut.shortcutName, withExtension: "shortcut", subdirectory: "web/shortcuts")
    }

    private static func log(_ s: String) { LocalVPN.log("\(RestoreShortcut.shortcutName) Shortcut: \(s)") }

    private static func add(_ c: Bridge.Call) {
        guard let file else { return c.reply(nil, refusal) }
        guard let top = MyIPAs.topController() else { return c.reply(nil, "no screen to show the share sheet on") }
        let vc = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        vc.completionWithItemsHandler = { type, done, _, _ in
            log("share sheet \(done ? "sent to \(type?.rawValue ?? "?")" : "closed")")
            c.reply(["opened": done], nil)
        }
        if let pop = vc.popoverPresentationController {
            pop.sourceView = top.view
            pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY, width: 1, height: 1)
        }
        top.present(vc, animated: true)
    }

    private static func answer(_ c: Bridge.Call, _ k: RestoreShortcut.Kind) {
        DispatchQueue.global(qos: .userInitiated).async {
            let r = run(k)
            Apt.reply(c, ["ok": r.error == nil, "error": (r.error as Any?) ?? NSNull(), "text": (r.text as Any?) ?? NSNull()], nil)
        }
    }

    /// Blocking. error: nil when it passed.
    private static func run(_ k: RestoreShortcut.Kind) -> (error: String?, text: String?) {
        // the page sees itself visible again a moment before iOS calls the app active, and refuses the open until then
        let t0 = Date()
        while !CellularShortcutBridge.active(), Date().timeIntervalSince(t0) < 3 { Thread.sleep(forTimeInterval: 0.1) }
        guard CellularShortcutBridge.active() else { return ("not_opened", nil) }
        // what is up is read last, just before Shortcuts opens
        if let code = RestoreShortcut.begin(k, vpnUp: !LocalVPN.isDown(), otherVPN: LocalVPN.otherVPNUp()) {
            log("\(k.rawValue) not run: \(code)")
            return (code, nil)
        }
        let verdict = drive(k)
        RestoreShortcut.end()
        guard case .failed(let code, let text) = verdict else {
            log("\(k.rawValue) done")
            return (nil, nil)
        }
        log("\(k.rawValue) failed: \(code)\(text.map { " (\($0))" } ?? ""); up tunnels: \(LocalVPN.tunnelList(LocalVPN.tunnelAddresses()))")
        return (code, text)
    }

    /// Blocking: opens the Shortcut, then judges the run ten times a second until it is decided.
    private static func drive(_ k: RestoreShortcut.Kind) -> RestoreShortcut.Verdict {
        var verdict = open(k)
        var elapsed = 0.0, front = 0.0, left = false // left: the app went behind Shortcuts
        while verdict == .wait {
            Thread.sleep(forTimeInterval: 0.1)
            lock.lock(); let back = called, text = said; lock.unlock()
            elapsed += 0.1
            if !CellularShortcutBridge.active() { left = true; front = 0 } else if left || back { front += 0.1 }
            verdict = RestoreShortcut.verdict(RestoreShortcut.report, elapsed: elapsed, front: front,
                                              otherVPN: LocalVPN.otherVPNUp(), said: text)
        }
        lock.lock(); runID = nil; called = false; said = nil; lock.unlock()
        return verdict
    }

    /// Opens Shortcuts on the Shortcut. Blocking; .wait once it opened.
    private static func open(_ k: RestoreShortcut.Kind) -> RestoreShortcut.Verdict {
        let id = UUID().uuidString
        lock.lock(); runID = id; called = false; said = nil; lock.unlock()
        guard let url = RestoreShortcut.runURL(k, back: { "ifizbox://\(host)?id=\(id)&r=\($0)" }) else { return .failed("not_opened", nil) }
        let sem = DispatchSemaphore(value: 0)
        var opened = false // written before the signal
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in opened = ok; sem.signal() }
        }
        return sem.wait(timeout: .now() + 10) == .success && opened ? .wait : .failed("not_opened", nil)
    }

    /// ifizbox://restore-vpn?id=…&r=ok|error|cancel[&errorMessage=…], Shortcuts coming back. True when it was one. It
    /// judges nothing: its error is only told on.
    static func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "ifizbox", url.host == host else { return false }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let v = { (k: String) in q.first { $0.name == k }?.value }
        let error: String? = v("r") == "ok" ? nil : v("errorMessage") ?? (v("r") == "cancel" ? "canceled" : "the Shortcut failed")
        lock.lock()
        if let id = runID, v("id") == id { called = true; said = error }
        lock.unlock()
        return true
    }
}
