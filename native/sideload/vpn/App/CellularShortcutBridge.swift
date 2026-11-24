// Adds the Cellular Installs Shortcut and checks it (CellularShortcut.swift has the run state and the rules).
//   cellular.status  {available, bundled, added}
//                    available: iOS 16+, the sideload build, and its actions are under the ID the signed Shortcut names
//                    bundled: the signed Shortcut is in this build; added: the last check passed
//   cellular.add     our signed Shortcut (web/shortcuts, tools/shortcuts/sign.sh) in a share sheet, where Shortcuts opens
//                    it on Add Shortcut: {opened} when the sheet closes. Shortcuts never says it was added: check it
//   cellular.check   runs it with {"check":1}, which touches no cellular data: {ok, error, text, status}. ok only when
//                    its Finish Cellular Installs ran in the app; error is CellularShortcut.Verdict's code
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit

enum CellularShortcutBridge {
    private static let addedKey = "ifizbox.cellular.added"
    private static let host = "cellular-installs"
    private static let lock = NSLock()
    private static var runID: String? // guarded by lock: the run whose callback counts
    private static var called = false, said: String? // guarded by lock: its callback came, and the last one's error

    static func register(_ b: Bridge) {
        b.on("cellular.status") { c in Apt.reply(c, status(), nil) }
        b.on("cellular.add") { c in
            if let e = refusal { return Apt.reply(c, nil, e) }
            DispatchQueue.main.async { add(c) }
        }
        b.on("cellular.check") { c in
            if let e = refusal { return Apt.reply(c, nil, e) }
            DispatchQueue.global(qos: .userInitiated).async {
                let r = check()
                Apt.reply(c, ["ok": r.error == nil, "error": (r.error as Any?) ?? NSNull(), "text": (r.text as Any?) ?? NSNull(), "status": status()], nil)
            }
        }
    }

    /// The actions are in this build under the ID the signed Shortcut names (a signer may have renamed the app).
    static var available: Bool {
        guard #available(iOS 16.0, *) else { return false }
        return AppMode.current != .jailbreak && Bundle.main.bundleIdentifier == SignOptions.selfBundleID
    }
    private static var refusal: String? {
        available ? nil : "unavailable: \(CellularShortcut.shortcutName) needs iOS 16 and the sideload app under its own bundle ID"
    }
    private static var file: URL? {
        Bundle.main.url(forResource: CellularShortcut.shortcutName, withExtension: "shortcut", subdirectory: "web/shortcuts")
    }

    static func status() -> [String: Any] {
        ["available": available, "bundled": file != nil, "added": UserDefaults.standard.bool(forKey: addedKey)]
    }

    private static func add(_ c: Bridge.Call) {
        guard let file else { return c.reply(nil, "missing: \(CellularShortcut.shortcutName) isn't in this build") }
        guard let top = MyIPAs.topController() else { return c.reply(nil, "no screen to show the share sheet on") }
        let vc = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        vc.completionWithItemsHandler = { type, done, _, _ in
            LocalVPN.log("\(CellularShortcut.shortcutName): share sheet \(done ? "sent to \(type?.rawValue ?? "?")" : "closed")")
            c.reply(["opened": done], nil)
        }
        if let pop = vc.popoverPresentationController {
            pop.sourceView = top.view
            pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY, width: 1, height: 1)
        }
        top.present(vc, animated: true)
    }

    /// Blocking. error: nil when it passed.
    private static func check() -> (error: String?, text: String?) {
        guard CellularShortcut.begin(.check, vpnUp: false) else { return ("busy", nil) }
        var verdict = open(.check)
        var left = false, front = 0.0, elapsed = 0.0 // the app went behind Shortcuts; seconds in front again, and in all
        while verdict == .wait {
            Thread.sleep(forTimeInterval: 0.1)
            lock.lock(); let back = called, text = said; lock.unlock()
            elapsed += 0.1
            if !active() { left = true; front = 0 } else if left || back { front += 0.1 }
            verdict = CellularShortcut.verdict(CellularShortcut.report, elapsed: elapsed, front: front, said: text)
        }
        lock.lock(); runID = nil; called = false; said = nil; lock.unlock()
        guard case .failed(let code, let text) = verdict else {
            UserDefaults.standard.set(true, forKey: addedKey)
            LocalVPN.log("\(CellularShortcut.shortcutName): check passed")
            return (nil, nil)
        }
        _ = CellularShortcut.giveUp()
        // one that never opened Shortcuts says nothing about the Shortcut
        if code != "not_opened" { UserDefaults.standard.set(false, forKey: addedKey) }
        LocalVPN.log("\(CellularShortcut.shortcutName): check failed: \(code)\(text.map { " (\($0))" } ?? "")")
        return (code, text)
    }

    private static func active() -> Bool {
        DispatchQueue.main.sync { UIApplication.shared.applicationState == .active }
    }

    /// Opens Shortcuts on the Shortcut. Blocking; .wait once it opened.
    private static func open(_ k: CellularShortcut.Kind) -> CellularShortcut.Verdict {
        let id = UUID().uuidString
        lock.lock(); runID = id; called = false; said = nil; lock.unlock()
        guard let url = CellularShortcut.runURL(k, back: { "ifizbox://\(host)?id=\(id)&r=\($0)" }) else { return .failed("not_opened", nil) }
        // the page sees itself visible again a moment before iOS calls the app active, and refuses the open until then
        let t0 = Date()
        while !active(), Date().timeIntervalSince(t0) < 3 { Thread.sleep(forTimeInterval: 0.1) }
        guard active() else { return .failed("not_opened", nil) }
        let sem = DispatchSemaphore(value: 0)
        var opened = false // written before the signal
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in opened = ok; sem.signal() }
        }
        return sem.wait(timeout: .now() + 10) == .success && opened ? .wait : .failed("not_opened", nil)
    }

    /// ifizbox://cellular-installs?id=…&r=ok|error|cancel[&errorMessage=…], Shortcuts coming back. True when it was one.
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
