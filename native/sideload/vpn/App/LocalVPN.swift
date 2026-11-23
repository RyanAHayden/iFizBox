// The built-in VPN for This iPhone installs (sideload build only): the app's side of PlugIns/iFizBoxVPN.appex
// (../Extension/PacketTunnelProvider.swift, the phone at 10.7.0.1). IDevice.Session turns it on just before it
// connects to iOS and off a moment after the last connection ends (`linger`, so a queue of installs or a reconnect
// keeps it), so the user's own VPN (Tailscale) is paused only while an app installs; iOS brings it back through its
// VPN On Demand.
// On cellular (cellular in use, no Wi-Fi), with the user's two Shortcuts added (Settings > Installation & Signing >
// This iPhone > Cellular Shortcuts), "Cellular Data Off" runs just before the connect and "Cellular Data On" once it
// is connected, as SideStore's Cellular Refresh: iOS refuses these connections while cellular data is in use
// (journal/2026-11-21-r72-cellular-this-iphone). They run through Shortcuts' x-callback-url, which comes back to the
// app (ifizbox://vpn-shortcut, App.swift's Incoming hands it here).
//   vpn.status          {available, bundled, entitled, tested, on, cellular, wifi, shortcuts: {off, on}}; also in
//                       idevice.status as `vpn`
//   vpn.test            the VPN on, one connect to iOS with the pairing (idevice.verify), the VPN off: {ok, ms, kind};
//                       a pass marks This iPhone tested (set up)
//   vpn.setShortcut     {which: "off"|"on", added} -> status: the user added (or removed) that Shortcut
//   vpn.openShortcuts   {which, url}: our signed Shortcut in a share sheet, for Shortcuts' Add Shortcut ({opened, via})
//   vpn.checkShortcut   {which}: runs it with a text input (it then does nothing) and marks it added only when it
//                       ran: {ok, error, status}
//   vpn.testShortcuts   runs Cellular Data Off, then Cellular Data On: {ok, off: {ok, error}, on: {ok, error},
//                       cellular, wentOff}; a pass marks both added
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Network
import NetworkExtension
import UIKit

enum LocalVPN {
    static let peer = "10.7.0.1"
    static var name: String { "\(Brand.name) VPN" }
    static let testedKey = "ifizbox.vpn.tested"
    static let shortcutKeys = ["off": "ifizbox.vpn.shortcut.off", "on": "ifizbox.vpn.shortcut.on"]
    /// The Shortcuts' names, as the user names them (the page says these words).
    static let shortcutNames = ["off": "Cellular Data Off", "on": "Cellular Data On"]
    /// How long the VPN stays on after the last connection ends: the next install of a queue, or a reconnect, finds it on.
    static let linger: TimeInterval = 3
    static let startLimit: TimeInterval = 10 // from startVPNTunnel to connected
    static let saveLimit: TimeInterval = 90 // the first save waits for the user's Allow on iOS's "Add VPN Configurations"
    static let shortcutLimit: TimeInterval = 25 // a Shortcut's run, until Shortcuts comes back to the app
    static let dataOffLimit: TimeInterval = 5 // after Cellular Data Off, for the path to leave cellular

    static func log(_ s: String) { IDevice.ilog("vpn: \(s)") }

    // ---- What this build has

    /// The extension's CFBundleIdentifier, as signed (a signer may have renamed it), or nil when the bundle has none.
    static let providerID: String? = {
        guard let dir = Bundle.main.builtInPlugInsURL?.appendingPathComponent("\(Brand.name)VPN.appex"),
              let info = NSDictionary(contentsOf: dir.appendingPathComponent("Info.plist")) as? [String: Any] else { return nil }
        return info["CFBundleIdentifier"] as? String
    }()

    /// The app's own profile allows a packet tunnel (the App ID has Network Extensions). Without it iOS refuses to
    /// save the configuration, and This iPhone uses the other ways in.
    static let entitled: Bool = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url), let p = try? Profile(data) else { return false }
        let kinds = p.entitlements["com.apple.developer.networking.networkextension"] as? [String] ?? []
        return kinds.contains("packet-tunnel-provider")
    }()

    static var available: Bool { AppMode.current != .jailbreak && providerID != nil && entitled }
    static var tested: Bool { UserDefaults.standard.bool(forKey: testedKey) }

    static func status() -> [String: Any] {
        let path = Path.now()
        var sc: [String: Bool] = [:]
        for (k, key) in shortcutKeys { sc[k] = UserDefaults.standard.bool(forKey: key) }
        lock.lock(); let on = cached?.connection.status == .connected; lock.unlock()
        return ["available": available, "bundled": providerID != nil, "entitled": entitled, "tested": tested, "on": on,
                "cellular": path.cellular, "wifi": path.wifi, "shortcuts": sc, "name": name]
    }

    // ---- The network path (cellular or Wi-Fi)

    enum Path {
        private static let monitor = NWPathMonitor()
        private static let queue = DispatchQueue(label: "ifizbox.vpn.path")
        private static var started = false
        private static var path: Network.NWPath?
        private static let plock = NSLock()

        static func start() {
            plock.lock(); defer { plock.unlock() }
            guard !started else { return }
            started = true
            monitor.pathUpdateHandler = { p in plock.lock(); path = p; plock.unlock() }
            monitor.start(queue: queue)
        }

        /// cellular: cellular data is in use and Wi-Fi isn't (Wi-Fi switched on but not joined counts as no Wi-Fi).
        static func now() -> (cellular: Bool, wifi: Bool) {
            start()
            plock.lock(); let p = path; plock.unlock()
            guard let p = p, p.status == .satisfied else { return (false, false) }
            let wifi = p.usesInterfaceType(.wifi)
            return (p.usesInterfaceType(.cellular) && !wifi, wifi)
        }
    }

    // ---- The tunnel

    private static let lock = NSLock()
    private static var cached: NETunnelProviderManager? // guarded by lock
    private static var holds = 0 // guarded by lock
    private static var stopGen = 0 // guarded by lock: a scheduled stop runs only if nothing came after it
    private static var lastFailure: Date? // guarded by lock: begin() couldn't turn it on

    /// begin() failed less than a minute ago: a reconnect or the next install of a queue goes the other ways in
    /// instead of waiting on it again. vpn.test always tries.
    static func failedNow() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return lastFailure.map { Date().timeIntervalSince($0) < 60 } ?? false
    }

    /// Blocking, never on the main thread: our configuration, saved and enabled, loaded again (iOS wants a load after
    /// a save before the tunnel starts). The first save shows iOS's "Add VPN Configurations" and waits for Allow.
    static func manager() throws -> NETunnelProviderManager {
        guard let id = providerID else { throw IDevice.Failure(code: "vpn_failed", text: "this build has no \(name)") }
        guard entitled else { throw IDevice.Failure(code: "vpn_failed", text: "the profile this app is signed with has no Network Extensions capability") }
        lock.lock(); let have = cached; lock.unlock()
        if let m = have, m.isEnabled { return m }
        let found: NETunnelProviderManager? = try wait("reading the VPN configuration", 10) { done in
            NETunnelProviderManager.loadAllFromPreferences { ms, err in
                done(err, ms?.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == id })
            }
        }
        let m = found ?? NETunnelProviderManager()
        let p = (m.protocolConfiguration as? NETunnelProviderProtocol) ?? NETunnelProviderProtocol()
        p.providerBundleIdentifier = id
        p.serverAddress = peer
        p.disconnectOnSleep = false
        m.protocolConfiguration = p
        m.localizedDescription = name
        m.isOnDemandEnabled = false
        m.isEnabled = true
        log(found == nil ? "saving a new configuration (iOS asks to allow it)" : "enabling the configuration")
        let _: Bool? = try wait("saving the VPN configuration", saveLimit) { done in m.saveToPreferences { done($0, true) } }
        let _: Bool? = try wait("loading the VPN configuration", 10) { done in m.loadFromPreferences { done($0, true) } }
        lock.lock(); cached = m; lock.unlock()
        return m
    }

    /// Runs `start` and waits for it to call `done(error, value)`, at most `limit` seconds. Blocking.
    private static func wait<T>(_ what: String, _ limit: TimeInterval, _ start: (@escaping (Error?, T?) -> Void) -> Void) throws -> T? {
        let sem = DispatchSemaphore(value: 0)
        var out: T?, failure: Error?
        start { e, v in failure = e; out = v; sem.signal() }
        guard sem.wait(timeout: .now() + limit) == .success else {
            throw IDevice.Failure(code: "vpn_failed", text: "\(what) took over \(Int(limit)) s")
        }
        if let e = failure {
            let ns = e as NSError
            // NEVPNError.configurationReadWriteFailed with "permission denied": the user tapped Don't Allow
            let text = ns.domain == NEVPNErrorDomain && ns.code == NEVPNError.configurationReadWriteFailed.rawValue
                ? "iOS didn't save the VPN configuration (\(ns.localizedDescription)). Allow it when iOS asks"
                : "\(what): \(ns.localizedDescription)"
            throw IDevice.Failure(code: "vpn_failed", text: text)
        }
        return out
    }

    /// The tunnel up (blocking): started if it isn't, then until iOS says connected.
    static func up(_ step: (String) -> Void = { _ in }) throws {
        let m = try manager()
        if m.connection.status == .connected { return }
        step("turning on \(name)")
        let t0 = Date()
        do { try m.connection.startVPNTunnel() } catch {
            // a configuration another app's VPN took over since: enable and save it again, then try once more
            lock.lock(); cached = nil; lock.unlock()
            let again = try manager()
            do { try again.connection.startVPNTunnel() } catch { throw IDevice.Failure(code: "vpn_failed", text: "\(name) didn't start: \(error.localizedDescription)") }
        }
        let conn = try manager().connection
        var seenConnecting = false
        while Date().timeIntervalSince(t0) < startLimit {
            switch conn.status {
            case .connected:
                log("on in \(String(format: "%.2f", Date().timeIntervalSince(t0))) s")
                return
            case .connecting, .reasserting: seenConnecting = true
            case .disconnected, .invalid:
                if seenConnecting { throw IDevice.Failure(code: "vpn_failed", text: "\(name) turned off as it started") }
            default: break
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
        throw IDevice.Failure(code: "vpn_failed", text: "\(name) didn't connect in \(Int(startLimit)) s")
    }

    /// The tunnel down now. The configuration stays saved (never removed): a new one would make iOS ask Allow on
    /// "Add VPN Configurations" again at the next install, so iOS asks once, at setup's test (user, B357).
    static func down() {
        lock.lock(); let m = cached; lock.unlock()
        guard let m = m else { return }
        if m.connection.status != .disconnected { m.connection.stopVPNTunnel(); log("off") }
    }

    /// Before a connect to iOS (blocking, on IDevice.queue): the VPN on, held until end(). On cellular with both
    /// Shortcuts added, Cellular Data Off runs too: the answer says so, and connected(dataOff:) turns it back on.
    static func begin(cellular: Bool = true, _ step: (String) -> Void = { _ in }) throws -> Bool {
        lock.lock(); holds += 1; stopGen += 1; lock.unlock()
        do { try up(step) } catch {
            lock.lock(); lastFailure = Date(); lock.unlock()
            end()
            throw error
        }
        lock.lock(); lastFailure = nil; lock.unlock()
        guard cellular, Path.now().cellular, shortcutsAdded() else { return false }
        step("running the Shortcut \(shortcutNames["off"]!)")
        let r = runShortcut("off")
        guard r.ok else { log("Cellular Data Off didn't run: \(r.error ?? "?"); connecting anyway"); return false }
        let t0 = Date()
        while Path.now().cellular && Date().timeIntervalSince(t0) < dataOffLimit { Thread.sleep(forTimeInterval: 0.1) }
        log(Path.now().cellular ? "cellular still in use after Cellular Data Off" : "cellular data off")
        return true
    }

    /// Once connected (or when the connect failed): Cellular Data On, when begin() turned it off. Not waited for.
    static func connected(dataOff: Bool) {
        guard dataOff else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let r = runShortcut("on")
            log(r.ok ? "cellular data on again" : "Cellular Data On didn't run: \(r.error ?? "?")")
        }
    }

    /// A connection ended: the VPN goes off `linger` seconds after the last one, unless another begins first.
    static func end() {
        lock.lock()
        holds = max(0, holds - 1)
        stopGen += 1
        let gen = stopGen, idle = holds == 0
        lock.unlock()
        guard idle else { return }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + linger) {
            lock.lock(); let stop = holds == 0 && stopGen == gen; lock.unlock()
            if stop { down() }
        }
    }

    // ---- Cellular Shortcuts

    static func shortcutsAdded() -> Bool { shortcutKeys.values.allSatisfy { UserDefaults.standard.bool(forKey: $0) } }

    private static var waiting: [String: (Bool, String?) -> Void] = [:] // callback id -> its run; guarded by lock

    /// Runs the Shortcut `which` ("off"/"on") through Shortcuts' x-callback-url and waits until Shortcuts comes back
    /// (blocking, never on the main thread). iOS opens another app only from the front, so a run from the background
    /// fails at once.
    /// B359: `check` runs it with a text input, which our Shortcuts (tools/shortcuts/) take as "do nothing": it proves
    /// the Shortcut is there under its name and runs, without turning cellular data off.
    static func runShortcut(_ which: String, check: Bool = false) -> (ok: Bool, error: String?) {
        guard let name = shortcutNames[which] else { return (false, "no Shortcut \(which)") }
        let id = UUID().uuidString
        let back = { (r: String) in "ifizbox://vpn-shortcut?id=\(id)&r=\(r)" }
        var c = URLComponents()
        c.scheme = "shortcuts"; c.host = "x-callback-url"; c.path = "/run-shortcut"
        c.queryItems = [URLQueryItem(name: "name", value: name), URLQueryItem(name: "x-success", value: back("ok")),
                        URLQueryItem(name: "x-error", value: back("error")), URLQueryItem(name: "x-cancel", value: back("cancel"))]
        if check { c.queryItems! += [URLQueryItem(name: "input", value: "text"), URLQueryItem(name: "text", value: "check")] }
        // B359: the page sees itself visible again, and Shortcuts' callback for the run before arrives, a moment before
        // iOS calls the app active: wait for it a little, or the open below is refused
        let t0 = Date()
        while !DispatchQueue.main.sync(execute: { UIApplication.shared.applicationState == .active }) && Date().timeIntervalSince(t0) < 3 {
            Thread.sleep(forTimeInterval: 0.1)
        }
        guard let url = c.url else { return (false, "bad Shortcut link") }
        let sem = DispatchSemaphore(value: 0)
        var out: (Bool, String?) = (false, nil)
        lock.lock(); waiting[id] = { ok, err in out = (ok, err); sem.signal() }; lock.unlock()
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState == .active else {
                return finish(id, false, "\(Brand.name) wasn't in front, so iOS wouldn't open Shortcuts")
            }
            UIApplication.shared.open(url, options: [:]) { ok in if !ok { finish(id, false, "Shortcuts didn't open") } }
        }
        if sem.wait(timeout: .now() + shortcutLimit) != .success {
            finish(id, false, "Shortcuts didn't come back in \(Int(shortcutLimit)) s")
            sem.wait()
        }
        return out
    }

    private static func finish(_ id: String, _ ok: Bool, _ err: String?) {
        lock.lock(); let f = waiting.removeValue(forKey: id); lock.unlock()
        f?(ok, err)
    }

    /// B359: vpn.openShortcuts {which, url}: our signed Shortcut (web/shortcuts/<name>.shortcut in the app, signed by
    /// tools/shortcuts/sign.sh) in a share sheet, where Shortcuts opens it on its Add Shortcut sheet (shortcuts://
    /// import-shortcut takes only iCloud links). Without the bundled file, `url` (the same file on the site) opens in
    /// Safari. Replies {opened, via: "share"|"site"} when the sheet closes; Shortcuts never says it was added, so the
    /// page runs vpn.checkShortcut once the user is back.
    static func importShortcut(_ c: Bridge.Call) {
        let w = c.params["which"] as? String ?? ""
        guard let name = shortcutNames[w] else { return c.reply(nil, "no Shortcut \(w)") }
        DispatchQueue.main.async {
            let file = Bundle.main.url(forResource: name, withExtension: "shortcut", subdirectory: "web/shortcuts")
            guard let file, let top = MyIPAs.topController() else {
                guard let s = c.params["url"] as? String, let u = URL(string: s) else { return c.reply(["opened": false], nil) }
                return UIApplication.shared.open(u, options: [:]) { ok in c.reply(["opened": ok, "via": "site"], nil) }
            }
            let vc = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            vc.completionWithItemsHandler = { type, done, _, _ in
                log("Shortcut \(name): share sheet \(done ? "sent to \(type?.rawValue ?? "?")" : "closed")")
                c.reply(["opened": done, "via": "share"], nil)
            }
            if let pop = vc.popoverPresentationController {
                pop.sourceView = top.view
                pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY, width: 1, height: 1)
            }
            top.present(vc, animated: true)
        }
    }

    /// ifizbox://vpn-shortcut?id=…&r=ok|error|cancel[&errorMessage=…], Shortcuts coming back. True when it was one.
    static func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "ifizbox", url.host == "vpn-shortcut" else { return false }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let v = { (k: String) in q.first { $0.name == k }?.value }
        let r = v("r") ?? "error"
        let err = r == "ok" ? nil : (v("errorMessage") ?? (r == "cancel" ? "the Shortcut was canceled" : "the Shortcut failed"))
        if let id = v("id") { finish(id, r == "ok", err) }
        return true
    }
}

enum LocalVPNBridge {
    static func register(_ b: Bridge) {
        LocalVPN.Path.start()
        b.on("vpn.status") { c in quick(c) { LocalVPN.status() } }
        b.on("vpn.test") { c in
            IDeviceBridge.run(c) {
                guard LocalVPN.available else { throw IDevice.Failure(code: "vpn_failed", text: "this app can't run \(LocalVPN.name): its profile has no Network Extensions capability") }
                // on first, so a VPN that doesn't start is this test's error (an install would go another way in)
                _ = try LocalVPN.begin(cellular: false) // the connect below runs the Cellular Shortcuts when needed
                defer { LocalVPN.end() }
                let t0 = Date() // the connect alone, not iOS's Allow on the first save
                let kind = try IDevice.verify()
                let ms = Int(Date().timeIntervalSince(t0) * 1000)
                UserDefaults.standard.set(true, forKey: LocalVPN.testedKey)
                return ["ok": true, "ms": ms, "kind": kind.rawValue]
            }
        }
        b.on("vpn.setShortcut") { c in
            quick(c) {
                if let w = c.params["which"] as? String, let key = LocalVPN.shortcutKeys[w] {
                    UserDefaults.standard.set((c.params["added"] as? Bool) ?? true, forKey: key)
                }
                return LocalVPN.status()
            }
        }
        b.on("vpn.openShortcuts") { c in LocalVPN.importShortcut(c) }
        b.on("vpn.checkShortcut") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: Cellular Shortcuts are for the sideload app's This iPhone installs") }
            guard let w = c.params["which"] as? String, let key = LocalVPN.shortcutKeys[w] else { return Apt.reply(c, nil, "no Shortcut given") }
            DispatchQueue.global(qos: .userInitiated).async {
                var r = LocalVPN.runShortcut(w, check: true)
                // just after Add Shortcut's Replace, Shortcuts can't find it for some seconds: try again (not after a
                // cancel or a run that never came back)
                for wait in [1.5, 3, 5] where !r.ok && r.error != "the Shortcut was canceled" && !(r.error ?? "").contains("didn't come back") {
                    LocalVPN.log("Shortcut \(w): \(r.error ?? "failed"), again in \(wait) s")
                    Thread.sleep(forTimeInterval: wait)
                    r = LocalVPN.runShortcut(w, check: true)
                }
                UserDefaults.standard.set(r.ok, forKey: key) // Added only once it ran
                Apt.reply(c, ["ok": r.ok, "error": (r.error as Any?) ?? NSNull(), "status": LocalVPN.status()], nil)
            }
        }
        b.on("vpn.testShortcuts") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
            DispatchQueue.global(qos: .userInitiated).async {
                let cellular = LocalVPN.Path.now().cellular
                let off = LocalVPN.runShortcut("off")
                var wentOff = false
                if off.ok && cellular {
                    let t0 = Date()
                    while LocalVPN.Path.now().cellular && Date().timeIntervalSince(t0) < LocalVPN.dataOffLimit { Thread.sleep(forTimeInterval: 0.1) }
                    wentOff = !LocalVPN.Path.now().cellular
                }
                let on = off.ok ? LocalVPN.runShortcut("on") : (ok: false, error: "not run")
                UserDefaults.standard.set(off.ok, forKey: LocalVPN.shortcutKeys["off"]!) // B359: Added only while it runs
                if off.ok { UserDefaults.standard.set(on.ok, forKey: LocalVPN.shortcutKeys["on"]!) }
                let r: [String: Any] = ["ok": off.ok && on.ok, "cellular": cellular, "wentOff": wentOff,
                                        "off": ["ok": off.ok, "error": (off.error as Any?) ?? NSNull()],
                                        "on": ["ok": on.ok, "error": (on.error as Any?) ?? NSNull()]]
                Apt.reply(c, r, nil)
            }
        }
    }

    static func quick(_ c: Bridge.Call, _ f: @escaping () -> Any?) { IDeviceBridge.quick(c, f) }
}
