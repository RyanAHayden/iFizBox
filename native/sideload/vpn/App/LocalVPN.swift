// The built-in VPN for This iPhone installs (sideload build only): the app's side of PlugIns/iFizBoxVPN.appex
// (../Extension/PacketTunnelProvider.swift, the phone at 10.7.0.1). IDevice.Session turns it on just before it
// connects to iOS and off a moment after the last connection ends (`linger`, so a queue of installs or a reconnect
// keeps it). Nothing else is involved: no Shortcuts, no trip, no put-back. iOS takes another app's VPN off while ours
// is on, so the status says `otherVPN` and the page says it. Whether that VPN comes back by itself (its On Demand) is
// iOS's and that app's business.
//   vpn.status          {available, bundled, entitled, tested, on, cellular, wifi, otherVPN, name}; also in
//                       idevice.status as `vpn`
//   vpn.test            the VPN on, one connect to iOS with the pairing (idevice.verify), the VPN off: {ok, ms, kind};
//                       a pass marks This iPhone tested (set up)
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
    static let startLimit: TimeInterval = 10 // from startVPNTunnel to connected
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
    static var tested: Bool { UserDefaults.standard.bool(forKey: testedKey) }

    static func status() -> [String: Any] {
        let path = Path.now()
        lock.lock(); let on = cached?.connection.status == .connected; lock.unlock()
        return ["available": available, "bundled": providerID != nil, "entitled": entitled, "tested": tested, "on": on,
                "cellular": path.cellular, "wifi": path.wifi, "otherVPN": otherVPNUp(), "name": name]
    }

    /// The keys of the Install Switch and Cellular Shortcuts, which this build no longer has: removed once at launch.
    private static let oldKeys = ["ifizbox.vpn.shortcut.off", "ifizbox.vpn.shortcut.on", "ifizbox.vpn.shortcut.switch",
                                  "ifizbox.vpn.shortcut.trip", "ifizbox.vpn.shortcut.idle", "ifizbox.vpn.switch.pending",
                                  "ifizbox.vpn.lost", "ifizbox.vpn.leftOff"]
    private static let clearedKey = "ifizbox.vpn.shortcutKeysCleared"
    static func clearOldKeys() {
        let d = UserDefaults.standard
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

        /// cellular: cellular data is in use and Wi-Fi isn't (Wi-Fi switched on but not joined counts as no Wi-Fi).
        static func now() -> (cellular: Bool, wifi: Bool) {
            start()
            plock.lock(); let p = path; plock.unlock()
            guard let p = p, p.status == .satisfied else { return (false, false) }
            let wifi = p.usesInterfaceType(.wifi)
            return (p.usesInterfaceType(.cellular) && !wifi, wifi)
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

    // ---- The tunnel

    private static let lock = NSLock()
    private static var cached: NETunnelProviderManager? // guarded by lock
    private static var holds = 0 // guarded by lock
    private static var stopGen = 0 // guarded by lock: a scheduled stop runs only if nothing came after it
    private static var installs = 0 // guarded by lock: installs going on (installBegan): a reconnect stays in its queue
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
        // B375: iOS starts no VPN without a network: it goes connecting then disconnected ("No network available")
        // faster than the loop below can see, which then waited out startLimit. Asked before manager(), whose
        // save takes the user's own VPN's place
        if !Path.online() {
            if connectedNow() { return }
            throw IDevice.Failure(code: "vpn_failed", text: "\(name) can't start without a network: iOS starts a VPN only with Wi-Fi or cellular data on")
        }
        lock.lock(); let on = cached?.connection.status == .connected; lock.unlock()
        if on { return }
        // Another VPN set since disabled ours, which the kept copy doesn't say: its start gives no error and never
        // connects. Read it again (manager() enables and saves it when off)
        lock.lock(); cached = nil; lock.unlock()
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

    /// Before a connect to iOS (blocking, on IDevice.queue): the VPN on, held until end().
    static func begin(_ step: (String) -> Void = { _ in }) throws {
        lock.lock(); holds += 1; stopGen += 1; lock.unlock()
        let tunnels = tunnelAddresses() // read before up() takes another VPN's place
        log("on; up tunnels: \(tunnelList(tunnels))")
        do { try up(step) } catch {
            lock.lock(); lastFailure = Date(); lock.unlock()
            end()
            throw error
        }
        lock.lock(); lastFailure = nil; lock.unlock()
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
    static func installBegan() { lock.lock(); installs += 1; lock.unlock() }
    static func installEnded() {
        lock.lock(); installs = max(0, installs - 1); lock.unlock()
        stopLater()
    }

    private static func stopLater() {
        lock.lock(); let gen = stopGen, idle = holds == 0 && installs == 0; lock.unlock()
        guard idle else { return }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + linger) {
            lock.lock(); let stop = holds == 0 && installs == 0 && stopGen == gen; lock.unlock()
            if stop { down() }
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
    static func connectedNow() -> Bool {
        guard let id = providerID else { return false }
        var status = NEVPNStatus.invalid // written before done() signals the wait
        let _: Bool? = try? wait("reading the VPN configuration", 5) { done in
            NETunnelProviderManager.loadAllFromPreferences { ms, err in
                let m = ms?.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == id }
                status = m?.connection.status ?? .invalid
                done(err, true)
            }
        }
        return status == .connected
    }
}

enum LocalVPNBridge {
    static func register(_ b: Bridge) {
        LocalVPN.Path.start()
        LocalVPN.clearOldKeys()
        b.on("vpn.status") { c in quick(c) { LocalVPN.status() } }
        b.on("vpn.test") { c in
            IDeviceBridge.run(c) {
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
