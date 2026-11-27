// The built-in VPN for This iPhone installs (sideload build only): the app's side of PlugIns/iFizBoxVPN.appex
// (../Extension/PacketTunnelProvider.swift, the phone at 10.7.0.1). IDevice.Session turns it on just before it
// connects to iOS and off a moment after the last connection ends (`linger`, so a queue of installs or a reconnect
// keeps it). The configuration stays saved. iOS takes another app's VPN off while ours
// is on, so the status says `otherVPN` and the page says it. Whether that VPN comes back by itself (its On Demand) is
// iOS's and that app's business, unless Restore My VPN is on: then its Shortcut sets that VPN again after the queue,
// or asks first once the app was left
// (RestoreBack.swift).
// B423: in the background it starts only to finish an install already connected; anything else waits for the app.
//   idevice.status      carries the VPN's state as `vpn`: {available, bundled, entitled, tested, on, cellular, wifi,
//                       otherVPN, restore, remembered, restoreNever, name, via}
//   vpn.setRestore      {on}: Restore My VPN (kept; off by default) -> the status' vpn
//   vpn.test           the VPN on, one connect to iOS with the pairing (idevice.verify), the VPN off: {ok, ms, kind};
//                       a pass marks This iPhone tested (set up)
//   vpn.setVia         {via: "builtin" | "app"}: Connect Through, the built-in VPN or LocalDevVPN (kept) -> the status' vpn
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Network
import NetworkExtension
import UIKit

enum LocalVPN {
    static let peer = "10.7.0.1"
    static var name: String { "\(Brand.name) VPN" }
    static let testedKey = "ifizbox.vpn.tested"
    /// How long the VPN stays on after the last connection ends: the next install of a queue, or a reconnect, finds it on.
    static let linger: TimeInterval = 3
    static let downWait: TimeInterval = 3 // from stopVPNTunnel to disconnected
    static let startLimit: TimeInterval = 10 // from startVPNTunnel to connected
    static let networkWait: TimeInterval = 8 // B428b: with no network, how long a start waits for one
    static let saveLimit: TimeInterval = 90 // the first save waits for the user's Allow on iOS's "Add VPN Configurations"

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
    /// Set up through the way in chosen now (Connect Through): each keeps its own test.
    static var tested: Bool { UserDefaults.standard.bool(forKey: viaApp ? appTestedKey : testedKey) }

    static func status() -> [String: Any] {
        let path = Path.now()
        lock.lock(); let on = cached?.connection.status == .connected; lock.unlock()
        return ["available": available, "bundled": providerID != nil, "entitled": entitled, "tested": tested, "on": on,
                "cellular": path.cellular, "wifi": path.wifi, "otherVPN": otherVPNUp(), "restore": restore,
                "remembered": RestoreBack.remembered, "restoreNever": RestoreBack.never, "name": name,
                "via": viaApp ? "app" : "builtin"]
    }

    // ---- Connect Through (F447): the built-in VPN, or LocalDevVPN
    // LocalDevVPN (free on the App Store) runs its own loopback VPN that reaches this phone at the same 10.7.0.1, so
    // This iPhone connects through it with nothing of ours turned on. It's the only way in for a profile without
    // Network Extensions (a free Apple ID). The person turns it on; iOS gives an app no way to switch another app's VPN.
    // vpn.setVia keeps the choice; the status' `via` says the one in use.
    static let appName = "LocalDevVPN"
    static let viaKey = "ifizbox.vpn.via"
    static let appTestedKey = "ifizbox.vpn.tested.app"
    /// LocalDevVPN is the way in: chosen, or the only one (no Network Extensions).
    static var viaApp: Bool { AppMode.current != .jailbreak && (!available || UserDefaults.standard.string(forKey: viaKey) == "app") }
    /// The built-in VPN turns on for each connect.
    static var inUse: Bool { available && !viaApp }
    /// The way in by name, for the log and the errors.
    static var routeName: String { viaApp ? appName : name }
    static func appOff() -> IDevice.Failure {
        IDevice.Failure(code: "vpn_app_off", text: "\(appName) is off: open it and tap Connect, then try again")
    }
    static func setVia(_ via: String) {
        UserDefaults.standard.set(via == "app" ? "app" : "builtin", forKey: viaKey)
        log("connect through: \(routeName)")
    }

    /// The keys of features this build no longer has: removed once at launch.
    private static let oldKeys = ["ifizbox.vpn.shortcut.off", "ifizbox.vpn.shortcut.on", "ifizbox.vpn.shortcut.switch",
                                  "ifizbox.vpn.shortcut.trip", "ifizbox.vpn.shortcut.idle", "ifizbox.vpn.switch.pending",
                                  "ifizbox.vpn.lost", "ifizbox.vpn.leftOff"]
    private static let clearedKey = "ifizbox.vpn.shortcutKeysCleared"
    static func clearOldKeys() {
        let d = UserDefaults.standard
        for k in ["ifizbox.vpn.restoreOwed", "ifizbox.vpn.restoredAt"] { d.removeObject(forKey: k) } // B427a: gone
        guard !d.bool(forKey: clearedKey) else { return }
        for k in oldKeys { d.removeObject(forKey: k) }
        d.set(true, forKey: clearedKey)
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

        /// cellular: cellular data is in use and Wi-Fi isn't joined (switched on but not joined counts as no Wi-Fi).
        /// B419: joined is also an IPv4 address on en0, whatever the path says: Wi-Fi Assist, Wi-Fi without internet
        /// and another VPN's route leave Wi-Fi joined but out of the path.
        static func now() -> (cellular: Bool, wifi: Bool) {
            start()
            plock.lock(); let p = path; plock.unlock()
            guard let p = p, p.status == .satisfied else { return (false, false) }
            let wifi = p.usesInterfaceType(.wifi) || wifiAddress()
            return (p.usesInterfaceType(.cellular) && !wifi, wifi)
        }

        /// en0 (Wi-Fi) is up and has an IPv4 address.
        static func wifiAddress() -> Bool {
            var head: UnsafeMutablePointer<ifaddrs>?
            guard getifaddrs(&head) == 0 else { return false }
            defer { freeifaddrs(head) }
            let up = IFF_UP | IFF_RUNNING
            var p = head
            while let i = p {
                defer { p = i.pointee.ifa_next }
                guard String(cString: i.pointee.ifa_name) == "en0", Int32(i.pointee.ifa_flags) & up == up,
                      let a = i.pointee.ifa_addr else { continue }
                if Int32(a.pointee.sa_family) == AF_INET { return true }
            }
            return false
        }

        /// The log's line: the path's status and interfaces in iOS's order, such as "satisfied; pdp_ip0 cellular,
        /// utun4 other; uses cellular; expensive; en0 IPv4 no".
        static func described() -> String {
            start()
            plock.lock(); let p = path; plock.unlock()
            let en0 = "en0 IPv4 \(wifiAddress() ? "yes" : "no")"
            guard let p = p else { return "no path yet; \(en0)" }
            let all = p.availableInterfaces.map { "\($0.name) \($0.type)" }.joined(separator: ", ")
            let types: [NWInterface.InterfaceType] = [.wifi, .cellular, .wiredEthernet, .loopback, .other]
            let used = types.filter { p.usesInterfaceType($0) }.map { "\($0)" }.joined(separator: ", ")
            return ["\(p.status)", all.isEmpty ? "no interfaces" : all, "uses \(used.isEmpty ? "none" : used)",
                    p.isExpensive ? "expensive" : nil, p.isConstrained ? "Low Data Mode" : nil, en0].compactMap { $0 }.joined(separator: "; ")
        }

        /// B375: some network is up (Wi-Fi, cellular data, wired), so iOS can start a VPN. True before the first
        /// path update arrives (not known yet: up() tries as before).
        static func online() -> Bool {
            start()
            plock.lock(); let p = path; plock.unlock()
            guard let p = p else { return true }
            return p.status == .satisfied
        }
    }

    // ---- The airplane wait
    // On cellular iOS refuses the connects an install needs, starts no VPN without a network, and keeps one that is up
    // when the network goes. So our VPN comes on first, then the install waits for the path to leave cellular.

    static let airplaneLimit: TimeInterval = 300 // how long an install waits for Airplane Mode
    static let airplaneSettle: TimeInterval = 1  // off cellular for this long: a passing gap isn't Airplane Mode
    static let airplaneReread: TimeInterval = 3  // B419: on cellular for this long before asking: a short Wi-Fi drop isn't cellular

    /// Blocking: true once the path has left cellular after `waiting` was said (the VPN on, kept by installBegan),
    /// false when it wasn't on cellular, or left it within airplaneReread. Wi-Fi joined ends it as well. Polled through NWPathMonitor's last path, so Control Center over the app changes nothing.
    /// Throws when cancelled, after airplaneLimit, or when the VPN doesn't start; installEnded then takes it down.
    /// B423: out of the app for awayGrace with the path still cellular, the wait pauses (pause()): its hold is let go,
    /// so the VPN goes off. Airplane Mode on isn't cellular, so the VPN is never dropped then.
    static func waitOffCellular(finishing: Bool, cancelled: () -> Bool, paused: (Pause) -> Void, waiting: () -> Void) throws -> Bool {
        guard inUse, !failedNow() else { return false } // F447: LocalDevVPN's tunnel is the person's to hold
        if finishing || !mustWait() { // B428b: here too, so Cancel ends it, and cellular coming back is seen below
            let online = try waitForNetwork({ _ in
                if cancelled() { throw IDevice.Failure(code: "cancelled", text: "Cancelled") }
            })
            if !online {
                guard !finishing, mustWait() else { throw noNetwork() }
                try waitForApp(cancelled: cancelled, paused: paused) // left meanwhile, perhaps to turn one on
            }
        }
        guard Path.now().cellular else { return false }
        log("on cellular before \(name) is on; path: \(Path.described())")
        func hold(_ finishing: Bool) throws {
            try begin(finishing: finishing) { _ in
                if cancelled() { throw IDevice.Failure(code: "cancelled", text: "Cancelled") } // while another install's start goes on
            }
        }
        try hold(finishing)
        var held = true
        defer { if held { end() } }
        var said = false // counted in offWaits
        func count(_ on: Bool) {
            guard on != said else { return }
            said = on
            lock.lock(); offWaits += on ? 1 : -1; lock.unlock()
        }
        defer { count(false) }
        log("on cellular: reading the path again for \(Int(airplaneReread)) s; path: \(Path.described())")
        var t0 = Date() // after begin: Wi-Fi can drop as the VPN starts
        var left: Date?
        var asked = false
        while true {
            if cancelled() {
                log("the airplane wait was cancelled")
                throw IDevice.Failure(code: "cancelled", text: "Cancelled")
            }
            let now = Path.now()
            if now.wifi && !asked {
                log("on Wi-Fi: no wait; path: \(Path.described())")
                return false
            }
            // Cellular Installs is being opened (its verdict has its own limits): the VPN stays on, for iOS starts none once
            // data is off; after a failed run there is the whole time again
            let running = CellularShortcut.running
            if running && asked { t0 = Date() }
            if now.cellular, !running, IDevice.AppFront.away >= awayGrace {
                log("out of the app for \(Int(awayGrace)) s, still on cellular: the wait pauses")
                count(false)
                end()
                held = false
                let before = Date()
                try pause(cancelled: cancelled, paused: paused)
                try hold(false)
                held = true
                t0 += Date().timeIntervalSince(before) // the pause isn't part of airplaneLimit
                left = nil
                if asked { count(true); waiting() }
                continue
            }
            if now.cellular { left = nil } else if left == nil { left = Date() }
            if let l = left, Date().timeIntervalSince(l) >= airplaneSettle {
                log("off cellular after \(Int(Date().timeIntervalSince(t0))) s; path: \(Path.described())")
                return asked
            }
            if now.cellular && !asked && Date().timeIntervalSince(t0) >= airplaneReread {
                asked = true
                log("on cellular: waiting for Wi-Fi or Airplane Mode; path: \(Path.described())")
                count(true)
                waiting()
            }
            if Date().timeIntervalSince(t0) > airplaneLimit {
                log("no Airplane Mode in \(Int(airplaneLimit)) s")
                throw IDevice.Failure(code: "airplane_timeout", text: "Airplane Mode wasn't turned on in \(Int(airplaneLimit / 60)) minutes, so nothing was installed")
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private static var offWaits = 0 // guarded by lock: installs that said they wait, the VPN on
    /// An install waits on cellular now, our VPN held on for it: Cellular Installs may run.
    static func waitsOnCellular() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return offWaits > 0
    }

    // ---- The app out of sight (B423)
    // KeepAlive keeps the app running in the background through an install, so the VPN could come on (or stay on) over
    // the user's own VPN after they left. In the background it starts only to finish an install already connected.

    static let awayGrace: TimeInterval = 30 // a trip to Settings for Airplane Mode: the wait's VPN stays on this long
    static let awayLimit: TimeInterval = 300 // how long a check (no install) waits awake for the app to be opened

    /// A start isn't allowed now: the app is in the background and the tunnel isn't up already.
    private static func mustWait() -> Bool {
        guard !IDevice.AppFront.now else { return false }
        lock.lock(); defer { lock.unlock() }
        return cached?.connection.status != .connected
    }

    /// Before an install's first connect: blocking until the app is in front, when the VPN would have to start.
    static func waitForApp(cancelled: () -> Bool, paused: (Pause) -> Void) throws {
        guard inUse, mustWait() else { return } // F447: nothing of ours to start through LocalDevVPN
        log("in the background: the install waits for the app to be opened")
        try pause(cancelled: cancelled, paused: paused)
    }

    /// app: waiting for the app to be opened; network: opened, but with none (Airplane Mode went on meanwhile) iOS
    /// starts no VPN; over: going on, or cancelled.
    enum Pause { case app, network, over }

    /// An install waits, blocking, for the app to be in front; it holds nothing meanwhile. `paused(.app)` lets go of
    /// its KeepAlive too, so iOS can suspend the app; no time limit.
    private static func pause(cancelled: () -> Bool, paused: (Pause) -> Void) throws {
        paused(.app)
        lock.lock(); pauses += 1; lock.unlock() // before installEnded: the other VPN isn't brought back in between
        installEnded()
        defer {
            installBegan()
            lock.lock(); pauses -= 1; lock.unlock()
            paused(.over)
        }
        var offline = false
        while !IDevice.AppFront.now || !Path.online() {
            let off = IDevice.AppFront.now // in front, so it is the network that is missing
            if off != offline { offline = off; paused(off ? .network : .app) }
            if cancelled() { throw IDevice.Failure(code: "cancelled", text: "Cancelled") }
            Thread.sleep(forTimeInterval: 0.25)
        }
        log("the app is in front: going on")
    }

    /// At launch and on coming back: nothing is going on and our tunnel is up (a killed or suspended app left it, or
    /// Settings turned it on): down.
    static func takeDownLeftOver() {
        guard available, let id = providerID else { return }
        NETunnelProviderManager.loadAllFromPreferences { ms, _ in
            let m = ms?.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == id }
            guard let m = m, [.connected, .connecting, .reasserting].contains(m.connection.status) else { return RestoreBack.look() }
            DispatchQueue.global(qos: .utility).async {
                downIfIdle(m, why: "left on with nothing going on")
                RestoreBack.look()
            }
        }
    }

    /// Blocking, never on the main thread: `m`'s tunnel down, unless something holds it (or a start came after `gen`).
    /// Under startLock, until iOS says it is off, so a start never meets a tunnel on its way down.
    private static func downIfIdle(_ m: NETunnelProviderManager, gen: Int? = nil, why: String) {
        func idle() -> Bool {
            lock.lock(); defer { lock.unlock() }
            return holds == 0 && installs == 0 && (gen == nil || gen == stopGen)
        }
        guard idle() else { return } // a start going on has a hold: no waiting for startLock
        startLock.lock()
        defer { startLock.unlock() }
        guard idle(), ![.disconnected, .invalid].contains(m.connection.status) else { return }
        takeDown(m) { log("off (\(why)); the configuration stays") }
    }

    /// Blocking, under startLock: `m`'s tunnel stopped, until iOS says it is off (downWait at most). Nothing when it is.
    private static func takeDown(_ m: NETunnelProviderManager, _ stopped: () -> Void = {}) {
        guard ![.disconnected, .invalid].contains(m.connection.status) else { return }
        m.connection.stopVPNTunnel()
        stopped()
        let t0 = Date()
        while m.connection.status != .disconnected, m.connection.status != .invalid, Date().timeIntervalSince(t0) < downWait {
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    // ---- Restore My VPN (F411, F419)
    // Our configuration keeps Settings > VPN's checkmark after a connect, so the VPN it took the place of stays off, On
    // Demand or not. With the setting on, RestoreBack brings that VPN back after the queue.

    private static let restoreKey = "ifizbox.vpn.restore"
    static var restore: Bool { UserDefaults.standard.bool(forKey: restoreKey) }
    static func setRestore(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: restoreKey)
        log("Restore My VPN turned \(on ? "on" : "off")")
        if !on { RestoreBack.forget() }
    }

    private static var pauses = 0 // guarded by lock: installs waiting in pause(), which hold nothing else

    /// The queue isn't over, with the tunnel off: an install waits for the app, or an app is being downloaded, signed or
    /// installed.
    static func waiting() -> Bool {
        lock.lock(); let n = pauses; lock.unlock()
        return n > 0 || SignJob.anyGoing
    }

    /// Blocking: runs `f` with no start of ours going on or beginning. A start waits for it, and can be cancelled.
    static func withNoStart<T>(_ f: () -> T) -> T {
        startLock.lock(); defer { startLock.unlock() }
        return f()
    }
    /// Nothing when a start isn't over by then.
    static func withNoStart(before t: Date, _ f: () -> Void) {
        guard startLock.lock(before: t) else { return }
        defer { startLock.unlock() }
        f()
    }

    /// The tunnel stops itself after a minute without packets (PacketTunnelProvider), for an app that was killed.
    /// While anything holds it, a packet every beatEvery says the app is still there (a provider message doesn't:
    /// on iOS 27 sendProviderMessage answers nil and never reaches the extension).
    static let beatEvery: TimeInterval = 15
    private static var beating = false // guarded by lock
    private static func beat() {
        lock.lock(); let start = !beating; beating = true; lock.unlock()
        if start { beatLater() }
    }
    private static func beatLater() {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + beatEvery) {
            lock.lock()
            let go = holds > 0 || installs > 0
            beating = go
            let on = cached?.connection.status == .connected
            lock.unlock()
            guard go else { return }
            if on { beatPacket() }
            beatLater()
        }
    }

    /// One UDP byte to the peer's discard port, through the tunnel's route.
    private static func beatPacket() {
        let fd = socket(AF_INET, SOCK_DGRAM, 0)
        guard fd >= 0 else { return }
        defer { close(fd) }
        var a = sockaddr_in()
        a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        a.sin_family = sa_family_t(AF_INET)
        a.sin_port = UInt16(9).bigEndian
        a.sin_addr.s_addr = inet_addr(peer)
        let sent = withUnsafePointer(to: &a) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, [UInt8(1)], 1, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        if sent < 0 { log("the packet that keeps \(name) on wasn't sent: \(String(cString: strerror(errno)))") }
    }

    // ---- The tunnel

    static let lock = NSLock() // held for a moment only (status() takes it): never while waiting on iOS
    private static let startLock = NSLock() // B418: one up() at a time; held while it waits on iOS. Taken before `lock`
    private(set) static var cached: NETunnelProviderManager? // guarded by lock
    static var closing = false // guarded by lock: downToClose (VPNClose.swift)
    private static var holds = 0 // guarded by lock
    private static var stopGen = 0 // guarded by lock: a scheduled stop runs only if nothing came after it
    private static var installs = 0 // guarded by lock: installs going on (installBegan): a reconnect stays in its queue
    private static var refusal: (at: Date, failure: IDevice.Failure)? // guarded by lock: iOS didn't save our configuration

    /// iOS refused our configuration less than a minute ago (the user tapped Don't Allow, or didn't answer): the rest
    /// of a queue isn't asked again. Any other failed start fails its own install only (B418). vpn.test asks anew.
    static func failedNow() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return refusal.map { Date().timeIntervalSince($0.at) < 60 } ?? false
    }

    /// Blocking, never on the main thread, under startLock (up() alone calls it): our configuration as iOS has it
    /// now, saved only when it isn't ours and enabled already. The first save shows iOS's "Add VPN Configurations"
    /// and waits for Allow. A save iOS calls stale (the configuration changed after the load) is done once more, on
    /// a new load.
    private static func manager() throws -> NETunnelProviderManager {
        guard let id = providerID else { throw IDevice.Failure(code: "vpn_failed", text: "this build has no \(name)") }
        guard entitled else { throw IDevice.Failure(code: "vpn_failed", text: "the profile this app is signed with has no Network Extensions capability") }
        var retried = false
        while true {
            let found: NETunnelProviderManager? = try wait("reading the VPN configuration", 10) { done in
                NETunnelProviderManager.loadAllFromPreferences { ms, err in
                    done(err, ms?.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == id })
                }
            }
            let m = found ?? NETunnelProviderManager()
            if found == nil || !isOurs(m) {
                let p = (m.protocolConfiguration as? NETunnelProviderProtocol) ?? NETunnelProviderProtocol()
                p.providerBundleIdentifier = id
                p.serverAddress = peer
                p.disconnectOnSleep = false
                m.protocolConfiguration = p
                m.localizedDescription = name
                m.isOnDemandEnabled = false
                m.isEnabled = true
                log(found == nil ? "saving a new configuration (iOS asks to allow it)" : "enabling the configuration")
                var stale = false // written before done() signals the wait
                do {
                    let _: Bool? = try wait("saving the VPN configuration", saveLimit, refusable: found == nil) { done in
                        m.saveToPreferences { err in
                            stale = isStale(err)
                            done(err, true)
                        }
                    }
                    // iOS wants a load after a save before the tunnel starts
                    let _: Bool? = try wait("loading the VPN configuration", 10) { done in
                        m.loadFromPreferences { err in stale = isStale(err); done(err, true) }
                    }
                } catch {
                    guard stale, !retried else { throw error }
                    retried = true
                    log("the configuration was stale: loading it again")
                    continue
                }
            }
            lock.lock(); cached = m; lock.unlock()
            return m
        }
    }

    /// `m`, as loaded, is what manager() would save.
    private static func isOurs(_ m: NETunnelProviderManager) -> Bool {
        guard let p = m.protocolConfiguration as? NETunnelProviderProtocol else { return false }
        return m.isEnabled && !m.isOnDemandEnabled && m.localizedDescription == name && p.serverAddress == peer && !p.disconnectOnSleep
    }

    private static func isStale(_ e: Error?) -> Bool {
        guard let ns = e as NSError? else { return false }
        return ns.domain == NEVPNErrorDomain && ns.code == NEVPNError.configurationStale.rawValue
    }

    /// Runs `start` and waits for it to call `done(error, value)`, at most `limit` seconds. Blocking. `refusable`:
    /// iOS asks the user, and a no (or no answer in time) is kept for failedNow().
    private static func wait<T>(_ what: String, _ limit: TimeInterval, refusable: Bool = false, _ start: (@escaping (Error?, T?) -> Void) -> Void) throws -> T? {
        let sem = DispatchSemaphore(value: 0)
        var out: T?, failure: Error?
        start { e, v in failure = e; out = v; sem.signal() }
        guard sem.wait(timeout: .now() + limit) == .success else {
            let f = IDevice.Failure(code: "vpn_failed", text: "\(what) took over \(Int(limit)) s")
            if refusable { refused(f) }
            throw f
        }
        if let e = failure {
            let ns = e as NSError
            // NEVPNError.configurationReadWriteFailed with "permission denied": the user tapped Don't Allow
            let denied = ns.domain == NEVPNErrorDomain && ns.code == NEVPNError.configurationReadWriteFailed.rawValue
            let text = denied
                ? "iOS didn't save the VPN configuration (\(ns.localizedDescription)). Allow it when iOS asks"
                : "\(what): \(ns.localizedDescription)"
            let f = IDevice.Failure(code: "vpn_failed", text: text)
            if refusable && denied { refused(f) }
            throw f
        }
        return out
    }

    private static func refused(_ f: IDevice.Failure) { lock.lock(); refusal = (Date(), f); lock.unlock() }

    /// The tunnel up (blocking): started if it isn't, then until iOS says connected. B418: one at a time, each install
    /// of a queue calls it: a later caller waits here, then finds the tunnel connected and saves nothing, or tries
    /// itself when the one before failed (unless iOS refused the configuration meanwhile: it isn't asked twice).
    /// B423: not while the app is in the background, unless `finishing` an install already connected: it waits for the
    /// app, without startLock, so a finishing start isn't held up.
    static func up(finishing: Bool = false, _ step: (String) throws -> Void = { _ in }) throws {
        let t0 = Date()
        var waited: TimeInterval = 0 // awake: a suspended app doesn't count
        while true {
            while !finishing && mustWait() {
                if waited == 0 { log("in the background: \(name) waits for the app to be opened") }
                guard waited < awayLimit else { throw IDevice.Failure(code: "vpn_failed", text: "\(name) starts only while \(Brand.name) is open") }
                try step("waiting for \(Brand.name)")
                Thread.sleep(forTimeInterval: 0.25)
                waited += 0.25
            }
            _ = try waitForNetwork(step) // start() says it when there is still none
            while !startLock.lock(before: Date().addingTimeInterval(1)) { try step("waiting for \(name)") }
            if finishing || !mustWait() { break } // it left while waiting for startLock: wait again
            startLock.unlock()
        }
        defer { startLock.unlock() }
        lock.lock(); let no = refusal, over = closing; lock.unlock()
        if over { throw IDevice.Failure(code: "vpn_failed", text: "\(Brand.name) is closing for its update") }
        if let no = no, no.at > t0 { throw no.failure }
        try start(finishing: finishing, step)
        lock.lock(); refusal = nil; lock.unlock()
    }

    /// B428b: a network is there, or our tunnel is up already (it needs none). Blocking, at most networkWait awake:
    /// after Airplane Mode, Wi-Fi or cellular data takes a few seconds to come back. Never under startLock; `step`
    /// throws to cancel.
    private static func waitForNetwork(_ step: (String) throws -> Void) throws -> Bool {
        if Path.online() || connectedNow() { return true }
        log("no network: waiting up to \(Int(networkWait)) s for one; path: \(Path.described())")
        var waited: TimeInterval = 0
        while waited < networkWait {
            try step("waiting for a network")
            Thread.sleep(forTimeInterval: 0.25)
            waited += 0.25
            if Path.online() {
                log("a network after \(String(format: "%.1f", waited)) s; path: \(Path.described())")
                return true
            }
        }
        log("no network in \(Int(networkWait)) s")
        return false
    }

    private static func noNetwork() -> IDevice.Failure {
        IDevice.Failure(code: "vpn_failed", text: "\(name) can't start without a network: iOS starts a VPN only with Wi-Fi or cellular data on")
    }

    /// up(), under startLock.
    private static func start(finishing: Bool, _ step: (String) throws -> Void) throws {
        // B375: iOS starts no VPN without a network: it goes connecting then disconnected ("No network available")
        // faster than the loop below can see, which then waited out startLimit. Asked before manager(), whose
        // save takes the user's own VPN's place
        if !Path.online() {
            if connectedNow() { return }
            throw noNetwork()
        }
        lock.lock(); let on = cached?.connection.status == .connected; lock.unlock()
        if on { return }
        var m: NETunnelProviderManager!
        // B443: a start that stalls is done once more, on a fresh read: the next row of a queue got through that way
        let stall = try VPNStart.twice({ attempt in
            // Another VPN set since disabled ours, which the kept copy doesn't say: its start gives no error and never
            // connects. manager() reads it again (and enables and saves it when off)
            RestoreBack.note()
            m = try manager()
            if m.connection.status == .connected { return nil }
            try step("turning on \(name)")
            let t0 = Date()
            do { try m.connection.startVPNTunnel() } catch {
                // another app's VPN took its place since, or it changed: read it again, then try once more
                RestoreBack.note()
                m = try manager()
                do { try m.connection.startVPNTunnel() } catch { throw IDevice.Failure(code: "vpn_failed", text: "\(name) didn't start: \(error.localizedDescription)") }
            }
            let conn = m.connection
            let stall = try VPNStart.watch(limit: startLimit, quiet: VPNStart.quiet(attempt, limit: startLimit),
                                           state: { stateOf(conn.status) }) { try step("turning on \(name)") }
            let took = String(format: "%.2f", Date().timeIntervalSince(t0))
            if let s = stall {
                log("start \(attempt) \(s.rawValue): \(stateOf(conn.status).rawValue) (status \(conn.status.rawValue)) after \(took) s; enabled \(m.isEnabled)")
            } else {
                log("on in \(took) s\(attempt > 1 ? " (start \(attempt))" : "")")
            }
            return stall
        }, again: { stall in
            log("\(name) \(stall.rawValue); path: \(Path.described()); up tunnels: \(tunnelList(tunnelAddresses()))")
            guard finishing || !mustWait() else { return false } // B423: no start once the app was left
            try step("turning on \(name) again")
            if m.connection.status == .connected { return true } // since: the next read finds it
            if !Path.online() { throw noNetwork() }
            takeDown(m) // stuck on its way up: a start would be ignored
            return true
        })
        switch stall {
        case nil: return
        case .turnedOff?: throw IDevice.Failure(code: "vpn_failed", text: "\(name) turned off as it started")
        default: throw IDevice.Failure(code: "vpn_failed", text: "\(name) didn't connect in \(Int(startLimit)) s")
        }
    }

    private static func stateOf(_ s: NEVPNStatus) -> VPNStart.State {
        switch s {
        case .connected: return .on
        case .connecting, .reasserting: return .starting
        case .disconnected, .invalid: return .off
        default: return .other
        }
    }

    /// Before a connect to iOS (blocking, on IDevice.queue): the VPN on, held until end().
    static func begin(finishing: Bool = false, _ step: (String) throws -> Void = { _ in }) throws {
        lock.lock(); holds += 1; stopGen += 1; lock.unlock()
        beat()
        let tunnels = tunnelAddresses() // read before up() takes another VPN's place
        log("on; up tunnels: \(tunnelList(tunnels))")
        do { try up(finishing: finishing, step) } catch {
            end()
            throw error
        }
    }

    /// A connection ended: the VPN goes off `linger` seconds after the last one, unless another begins first.
    static func end() {
        lock.lock()
        holds = max(0, holds - 1)
        stopGen += 1
        lock.unlock()
        stopLater()
    }

    /// An install, its reconnects and the pauses between them (up to 15 s, HereRecheck.pause) are one queue: the VPN
    /// stays on through them, and goes off `linger` seconds after the last one.
    static func installBegan() { lock.lock(); installs += 1; lock.unlock(); beat() }
    /// cancelled: the install ended on Cancel (B490): no linger, so a back run owed follows at once.
    static func installEnded(cancelled: Bool = false) {
        lock.lock(); installs = max(0, installs - 1); lock.unlock()
        stopLater(cancelled: cancelled)
    }

    private static func stopLater(cancelled: Bool = false) {
        lock.lock(); let gen = stopGen, idle = holds == 0 && installs == 0; lock.unlock()
        guard idle else { return }
        // B423: under a background task, so an app that iOS suspends meanwhile still takes it down
        let task = BackgroundHold("\(name) off") { stopNow() } // cut short: now, off the main thread
        if cancelled { log("the install was cancelled: off now") }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + RestoreDue.offAfter(linger: linger, cancelled: cancelled)) {
            stopNow(gen: gen)
            task.end()
        }
    }

    /// The tunnel down now, when idle. The configuration stays saved: a new one would make iOS ask Allow on "Add VPN
    /// Configurations" again at the next install, so iOS asks once, at setup's test (user, B357).
    private static func stopNow(gen: Int? = nil) {
        lock.lock(); let m = cached; lock.unlock()
        if let m = m { downIfIdle(m, gen: gen, why: "nothing left to do") }
        lock.lock(); let over = holds == 0 && installs == 0 && (gen == nil || gen == stopGen); lock.unlock()
        if over { RestoreBack.look() } // else what came after it looks, at its own end
    }

    /// One background task, ended once; `expiring` runs first when iOS ends it early, off the main thread (downIfIdle
    /// blocks), for expireLimit at most: iOS ends an app that keeps an expired task.
    final class BackgroundHold {
        private let lock = NSLock()
        private var id = UIBackgroundTaskIdentifier.invalid
        private var ended = false
        static let expireLimit: TimeInterval = 3
        init(_ name: String, expiring: (() -> Void)? = nil) {
            let task = UIApplication.shared.beginBackgroundTask(withName: name) {
                guard let f = expiring else { return self.end() }
                DispatchQueue.global(qos: .userInitiated).async { f(); self.end() }
                DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + Self.expireLimit) { self.end() }
            }
            lock.lock(); id = task; let late = ended; lock.unlock()
            if late { UIApplication.shared.endBackgroundTask(task) }
        }
        func end() {
            lock.lock(); let task = ended ? .invalid : id; ended = true; id = .invalid; lock.unlock()
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }
    }

    // ---- Other VPNs

    /// F388: another app's VPN is up now: a tunnel interface (utun, ipsec, ppp) that is up with an IPv4 address that
    /// isn't ours (10.7.0.x). iOS's own utun interfaces carry IPv6 only.
    static func otherVPNUp() -> Bool { !otherVPNAddresses().isEmpty }
    static func otherVPNAddresses(_ tunnels: [TunnelAddress] = tunnelAddresses()) -> Set<String> {
        Set(tunnels.filter { $0.family == AF_INET && !$0.address.hasPrefix("10.7.0.") }.map(\.address))
    }

    /// One address entry of a tunnel interface that is up; `address` is empty for a family other than IPv4 and IPv6.
    struct TunnelAddress { let name: String, family: Int32, address: String }

    /// Every address entry of the tunnel interfaces that are up, ours and iOS's own too.
    static func tunnelAddresses() -> [TunnelAddress] {
        var out: [TunnelAddress] = []
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { return out }
        defer { freeifaddrs(head) }
        var p = head
        while let i = p {
            defer { p = i.pointee.ifa_next }
            let name = String(cString: i.pointee.ifa_name)
            guard Int32(i.pointee.ifa_flags) & IFF_UP != 0, ["utun", "ipsec", "ppp"].contains(where: name.hasPrefix) else { continue }
            let family = i.pointee.ifa_addr.map { Int32($0.pointee.sa_family) } ?? AF_UNSPEC
            var buf = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            if let a = i.pointee.ifa_addr, family == AF_INET {
                var sin = a.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
                guard inet_ntop(family, &sin, &buf, socklen_t(buf.count)) != nil else { continue }
            } else if let a = i.pointee.ifa_addr, family == AF_INET6 {
                var sin6 = a.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { $0.pointee.sin6_addr }
                guard inet_ntop(family, &sin6, &buf, socklen_t(buf.count)) != nil else { continue }
            }
            out.append(TunnelAddress(name: name, family: family, address: String(cString: buf)))
        }
        return out
    }

    /// T77: the log's list of them, such as "utun3 IPv4 100.64.0.1, ipsec1 IPv6 fe80::1".
    static func tunnelList(_ tunnels: [TunnelAddress]) -> String {
        if tunnels.isEmpty { return "none" }
        return tunnels.map { t in
            switch t.family {
            case AF_INET: return "\(t.name) IPv4 \(t.address)"
            case AF_INET6: return "\(t.name) IPv6 \(t.address)"
            case AF_LINK: return "\(t.name) link"
            default: return "\(t.name) family \(t.family)"
            }
        }.joined(separator: ", ")
    }

    /// This VPN's configuration is connected now (read only: nothing saved, so iOS asks nothing). Blocking.
    static func connectedNow() -> Bool { saved()?.status == .connected }

    /// Nothing of ours is up or about to be: no install or connection uses it, and iOS says it is off. A read that failed
    /// isn't down. Blocking, read only.
    static func isDown() -> Bool { state()?.down ?? false }

    /// down: as isDown(). replaced: ours is saved but no longer enabled, so another VPN was picked since. nil when it
    /// couldn't be read. Blocking, read only.
    static func state() -> (down: Bool, replaced: Bool)? {
        lock.lock(); let used = holds > 0 || installs > 0; lock.unlock()
        if used, !RestoreBack.isClosing { return (false, false) } // closing: it is off for good
        guard let s = saved() else { return nil }
        return ([.disconnected, .invalid].contains(s.status), s.enabled == false)
    }

    /// Our configuration as iOS has it: .invalid and nil with none saved; nil when it couldn't be read. Blocking.
    private static func saved() -> (status: NEVPNStatus, enabled: Bool?)? {
        guard let id = providerID else { return (.invalid, nil) }
        var status = NEVPNStatus.invalid, enabled: Bool? // written before done() signals the wait
        let read: Bool? = try? wait("reading the VPN configuration", 5) { done in
            NETunnelProviderManager.loadAllFromPreferences { ms, err in
                let m = ms?.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == id }
                status = m?.connection.status ?? .invalid
                enabled = m?.isEnabled
                done(err, true)
            }
        }
        return read == nil ? nil : (status, enabled)
    }
}

enum LocalVPNBridge {
    static func register(_ b: Bridge) {
        LocalVPN.Path.start()
        LocalVPN.clearOldKeys()
        CellularShortcutBridge.register(b) // cellular.*
        RestoreShortcutBridge.register(b) // restore.*
        CellularRun.register(b) // cellular.run, and the put-back after a killed app
        DispatchQueue.main.async { RestoreBack.watch(); IDevice.AppFront.watch() }
        LocalVPN.takeDownLeftOver() // B423: a killed app's
        b.on("vpn.setRestore") { c in
            guard let on = c.params["on"] as? Bool else { return Apt.reply(c, nil, "bad_params: on") }
            quick(c) { LocalVPN.setRestore(on); return LocalVPN.status() }
        }
        b.on("vpn.setVia") { c in
            guard let via = c.params["via"] as? String, via == "app" || via == "builtin" else { return Apt.reply(c, nil, "bad_params: via") }
            if via == "builtin" && !LocalVPN.available {
                return Apt.reply(c, nil, "vpn_failed: this app can't run \(LocalVPN.name): its profile has no Network Extensions capability")
            }
            quick(c) { LocalVPN.setVia(via); return LocalVPN.status() }
        }
        b.on("vpn.test") { c in
            IDeviceBridge.run(c) {
                if LocalVPN.viaApp { // F447: through LocalDevVPN: nothing to turn on, only its tunnel to find
                    guard VPNCheck.appUp() else { throw LocalVPN.appOff() }
                    let t0 = Date()
                    let kind = try IDevice.verify()
                    let ms = Int(Date().timeIntervalSince(t0) * 1000)
                    UserDefaults.standard.set(true, forKey: LocalVPN.appTestedKey)
                    return ["ok": true, "ms": ms, "kind": kind.rawValue, "via": "app"]
                }
                guard LocalVPN.available else { throw IDevice.Failure(code: "vpn_failed", text: "this app can't run \(LocalVPN.name): its profile has no Network Extensions capability") }
                // on first, so a VPN that doesn't start is this test's error (an install would go another way in)
                try LocalVPN.begin()
                defer { LocalVPN.end() }
                let t0 = Date() // the connect alone, not iOS's Allow on the first save
                let kind = try IDevice.verify()
                let ms = Int(Date().timeIntervalSince(t0) * 1000)
                UserDefaults.standard.set(true, forKey: LocalVPN.testedKey)
                return ["ok": true, "ms": ms, "kind": kind.rawValue]
            }
        }
    }

    static func quick(_ c: Bridge.Call, _ f: @escaping () -> Any?) { IDeviceBridge.quick(c, f) }
}
