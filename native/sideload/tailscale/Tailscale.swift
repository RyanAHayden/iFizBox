// Tailscale as the "This iPhone" route's connection (README.md beside this file), sideload build only. iOS runs one
// VPN at a time; a Tailscale user keeps Tailscale on instead of switching to LocalDevVPN. The app runs its own tsnet
// node (tsnet.go) only while signing in, testing or installing, and idevice reaches this phone's own RemotePairing
// service through it: a 127.0.0.1 relay per port (the RPPairing port, then the tunnel's port, through
// idevice's tunnel_set_port_map), each connection dialed over the tailnet to the phone's own Tailscale address.
//
// Bridge calls (TailscaleBridge below):
//   tailscale.status      {address, signedIn, name, keyExpiry, connect, use}: quick, doesn't start the node
//   tailscale.setConnect  {value: "auto"|"localdevvpn"|"tailscale"} -> status (Settings > Installation's Connect With)
//   tailscale.signIn      starts the node; emits [{step: "login"}] and opens the login page when it needs one,
//                         [{step: "approval"}] when the tailnet wants it approved; replies status once it's in
//   tailscale.signInCancel ends a running tailscale.signIn (it replies "canceled: ..."); the page asks it when it's left
//                         while the sign-in starts or waits for approval
//   tailscale.test        RemotePairing's handshake to this phone through the tailnet: {ok, code, detail, peer, ms}; {verify: true}
//                         then checks the kept pairing through it (idevice.verify): {verified} or code verify_failed
//   tailscale.signOut     logs the node out and deletes its state but the machine key (the Keychain's copy too) -> status
//   tailscale.keepRoute   {value: "iphone"|"server"}: B218, Install Apps With kept in the Keychain beside the node
//   tailscale.keptRoute   -> the kept Install Apps With, or null (core/installroute.js keepRoute takes it on a fresh start)
import Darwin
import Foundation
import IDeviceFFI
import os
import SafariServices
import Security
import TailscaleFFI
import UIKit

enum Tailscale {
    static let connectKey = "ifizbox.installConnect" // auto | localdevvpn | tailscale
    static let nodeKey = "ifizbox.tailscale.node"   // {name, keyExpiry} once signed in
    static var deviceName = "iPhone"                 // UIDevice.current.name, read on the main thread at launch

    private static let osLog = OSLog(subsystem: "ifizbox.tailscale", category: "app")
    static func log(_ s: String) { os_log("%{public}@", log: osLog, type: .default, "\(Brand.name) tailscale: \(s)") }

    /// The node's state (its keys among it): Application Support, not backed up, unreadable until first unlock.
    static var stateDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("tailscale", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var v = URLResourceValues(); v.isExcludedFromBackup = true
        try? dir.setResourceValues(v)
        return dir
    }

    static var hostname: String { "\(Brand.name) on \(deviceName)" }
    static var connect: String { UserDefaults.standard.string(forKey: connectKey) ?? "auto" }
    static var node: [String: Any]? { UserDefaults.standard.dictionary(forKey: nodeKey) }

    /// This phone's own Tailscale address: an IPv4 in 100.64.0.0/10 on a utun interface that's up (the Tailscale app's
    /// VPN is on). nil when it's off.
    static func ownAddress() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { return nil }
        defer { freeifaddrs(head) }
        var p = head
        while let i = p {
            defer { p = i.pointee.ifa_next }
            let name = String(cString: i.pointee.ifa_name)
            guard name.hasPrefix("utun"), Int32(i.pointee.ifa_flags) & IFF_UP != 0,
                  let a = i.pointee.ifa_addr, a.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let addr = a.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            if addr & 0xFFC0_0000 == 0x6440_0000 { // 100.64.0.0/10
                return "\(addr >> 24).\((addr >> 16) & 255).\((addr >> 8) & 255).\(addr & 255)"
            }
        }
        return nil
    }

    /// Installs go through Tailscale: Connect With is Tailscale, or Automatic with the Tailscale VPN on, and the app's
    /// node is signed in.
    static func useForInstall() -> Bool {
        guard connect != "localdevvpn", node != nil, ownAddress() != nil else { return false }
        return true
    }

    static func status() -> [String: Any] {
        let n = node
        return ["address": ownAddress() ?? NSNull(), "signedIn": n != nil, "name": n?["name"] ?? NSNull(),
                "keyExpiry": n?["keyExpiry"] ?? NSNull(), "connect": connect, "use": useForInstall()]
    }

    static func json(_ p: UnsafeMutablePointer<CChar>?) -> [String: Any] {
        guard let p = p else { return [:] }
        defer { TSFree(p) }
        let d = Data(bytes: p, count: strlen(p))
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
    }

    /// Starts the node (or reads it, if it runs): {running, state, authURL, name, ips, keyExpiry, expired, error}.
    static func start() -> [String: Any] {
        TailscaleKeep.restoreState()
        let dir = strdup(stateDir.path), host = strdup(hostname)
        defer { free(dir); free(host) }
        let t0 = Date()
        let st = json(TSStart(dir, host))
        log("node started in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s: state \(st["state"] ?? "?"), \(st["error"] ?? "")")
        return st
    }

    static func current() -> [String: Any] { json(TSStatus()) }
    static func stop() { TSStop() }

    static func remember(_ st: [String: Any]) {
        var n: [String: Any] = ["name": st["name"] as? String ?? hostname]
        if let k = st["keyExpiry"] as? String, !k.isEmpty { n["keyExpiry"] = k }
        UserDefaults.standard.set(n, forKey: nodeKey)
        TailscaleKeep.keepNode(n)
        TailscaleKeep.keepState()
    }

    /// Only an explicit Sign Out comes here: the node's login goes, in the container and in the Keychain. B301: its
    /// machine key stays (the state is cut down to it), so the next Sign In comes back as the same machine in the
    /// tailnet instead of adding another "ifizbox-on-iphone-N". With no machine key to keep, the whole state goes.
    static func forget() {
        UserDefaults.standard.removeObject(forKey: nodeKey)
        let kept = TailscaleKeep.keepMachineKeyOnly()
        if !kept { try? FileManager.default.removeItem(at: stateDir) }
        TailscaleKeep.forgetNode(keepState: kept)
    }

    // ---- Installing (IDevice.Session, on IDevice.queue's thread)

    private static let lock = NSLock()
    private static var relayHost: String? // the phone's own Tailscale address while an install runs

    /// Starts the node for an install and returns the 127.0.0.1 port that reaches `port` on this phone. Blocking.
    static func beginInstall(port: UInt16) throws -> UInt16 {
        guard let own = ownAddress() else {
            throw IDevice.Failure(code: "connect_failed", text: "Tailscale is off: turn it on in the Tailscale app")
        }
        let st = start()
        if let e = st["error"] as? String, !e.isEmpty { stop(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale: \(e)") }
        switch st["state"] as? String ?? "" {
        case "Running": remember(st)
        case "NeedsMachineAuth":
            stop(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale: approve this device in the tailnet's admin console")
        case "NeedsLogin":
            stop(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale: sign in again in Settings > Installation (the device key expired)")
        case let s:
            stop(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale didn't connect (\(s.isEmpty ? "no answer" : s)); check the internet connection")
        }
        lock.lock(); relayHost = own; lock.unlock()
        let local = mapPort(port)
        guard local != port else { endInstall(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale: couldn't open the local relay") }
        tunnel_set_port_map { Tailscale.mapPort($0) }
        log("install through \(own):\(port) via 127.0.0.1:\(local) (node \(st["name"] ?? "?"))")
        return local
    }

    /// The local relay port for `port` on this phone (idevice asks for the tunnel's port this way); `port` itself when
    /// no install runs.
    static func mapPort(_ port: UInt16) -> UInt16 {
        lock.lock(); let host = relayHost; lock.unlock()
        guard let h = host else { return port }
        let c = strdup(h); defer { free(c) }
        let p = TSRelay(c, Int32(port))
        log("relay for port \(port): 127.0.0.1:\(p)")
        return p > 0 ? UInt16(p) : port
    }

    /// B220: a TCP connect to `port` on this phone's own Tailscale address through the running node (beginInstall or
    /// test started it), for IDevice.findRemotePairingPort. Blocking.
    static func probe(_ port: UInt16, host: String? = nil) -> VPNCheck.Probe {
        lock.lock(); let h = host ?? relayHost; lock.unlock()
        guard let h = h else { return .silent }
        let c = strdup(h); defer { free(c) }
        switch TSProbe(c, Int32(port), 3000) {
        case 1: return .connected
        case 0: return .refused
        default: return .silent
        }
    }

    static func endInstall() {
        tunnel_set_port_map(nil)
        lock.lock(); relayHost = nil; lock.unlock()
        stop()
        if node != nil { TailscaleKeep.keepState() } // B218: whatever tsnet wrote while it ran
        log("install connection closed; node stopped")
    }
}

enum TailscaleBridge {
    static func register(_ b: Bridge) {
        Tailscale.deviceName = UIDevice.current.name
        TailscaleKeep.restoreDefaults()
        b.on("tailscale.status") { c in IDeviceBridge.quick(c) { Tailscale.status() } }
        b.on("tailscale.setConnect") { c in
            IDeviceBridge.quick(c) {
                let v = c.params["value"] as? String ?? "auto"
                let value = ["auto", "localdevvpn", "tailscale"].contains(v) ? v : "auto"
                UserDefaults.standard.set(value, forKey: Tailscale.connectKey)
                TailscaleKeep.write(TailscaleKeep.connectAccount, Data(value.utf8))
                return Tailscale.status()
            }
        }
        b.on("tailscale.keepRoute") { c in
            let v = c.params["value"] as? String ?? ""
            guard ["iphone", "server"].contains(v) else { return Apt.reply(c, nil, "bad_params: value is iphone or server") }
            IDeviceBridge.quick(c) {
                TailscaleKeep.write(TailscaleKeep.routeAccount, Data(v.utf8))
                return true
            }
        }
        b.on("tailscale.keptRoute") { c in
            IDeviceBridge.quick(c) {
                guard let d = TailscaleKeep.read(TailscaleKeep.routeAccount), let v = String(data: d, encoding: .utf8),
                      ["iphone", "server"].contains(v) else { return NSNull() }
                return v
            }
        }
        b.on("tailscale.signIn") { c in
            setCanceled(false) // here, not on the queue: a cancel sent while it waits there still counts
            IDeviceBridge.run(c) { try signIn(c) }
        }
        b.on("tailscale.signInCancel") { c in
            setCanceled(true)
            Apt.reply(c, ["ok": true], nil)
        }
        b.on("tailscale.test") { c in IDeviceBridge.run(c) { try test(verify: c.params["verify"] as? Bool == true) } }
        b.on("tailscale.signOut") { c in
            IDeviceBridge.run(c) {
                if Tailscale.node != nil {
                    _ = Tailscale.start()
                    let r = Tailscale.json(TSLogout())
                    Tailscale.log("signed out: \(r)")
                }
                Tailscale.stop()
                Tailscale.forget()
                return Tailscale.status()
            }
        }
    }

    private static let cancelLock = NSLock()
    private static var signInCanceled = false
    private static func setCanceled(_ v: Bool) { cancelLock.lock(); signInCanceled = v; cancelLock.unlock() }
    private static var canceled: Bool { cancelLock.lock(); defer { cancelLock.unlock() }; return signInCanceled }

    private final class Sheet: NSObject, SFSafariViewControllerDelegate {
        var vc: SFSafariViewController?
        var closed = false // the user closed the login page
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { closed = true }
    }

    private static func topController() -> UIViewController? {
        let win = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows.first { $0.isKeyWindow } ?? ($0 as? UIWindowScene)?.windows.first }.first
        var top = win?.rootViewController
        while let p = top?.presentedViewController { top = p }
        return top
    }

    /// Starts the node; while it needs a login, shows Tailscale's login page in the app and waits (up to 10 min) until
    /// the node runs. Stops the node after.
    static func signIn(_ c: Bridge.Call) throws -> Any? {
        let sheet = Sheet()
        defer {
            Tailscale.stop()
            DispatchQueue.main.async { sheet.vc?.dismiss(animated: true) }
        }
        let stopped = IDevice.Failure(code: "canceled", text: "sign-in canceled: the page was left")
        if canceled { throw stopped }
        var st = Tailscale.start()
        if let e = st["error"] as? String, !e.isEmpty { throw IDevice.Failure(code: "tailscale", text: e) }
        var shownURL = "", lastState = ""
        let deadline = Date().addingTimeInterval(600)
        while Date() < deadline {
            let state = st["state"] as? String ?? ""
            if state != lastState { Tailscale.log("sign in: state \(state)"); lastState = state }
            if state == "Running", !((st["ips"] as? [Any]) ?? []).isEmpty {
                Tailscale.remember(st)
                Tailscale.log("signed in as \(st["name"] ?? "?")")
                return Tailscale.status()
            }
            if canceled { Tailscale.log("sign in: canceled by the page"); throw stopped }
            if state == "NeedsMachineAuth" { DispatchQueue.main.async { c.emit([["step": "approval"]]) } }
            if state == "NeedsLogin", let u = st["authURL"] as? String, !u.isEmpty, u != shownURL, let url = URL(string: u) {
                shownURL = u
                Tailscale.log("sign in: opening the login page")
                DispatchQueue.main.async {
                    c.emit([["step": "login"]])
                    sheet.vc?.dismiss(animated: false)
                    let vc = SFSafariViewController(url: url)
                    vc.delegate = sheet
                    sheet.vc = vc
                    sheet.closed = false
                    topController()?.present(vc, animated: true)
                }
            }
            if sheet.closed && state != "Running" {
                Thread.sleep(forTimeInterval: 2) // a login that just finished closes the page itself
                st = Tailscale.current()
                if st["state"] as? String == "Running" { continue }
                throw IDevice.Failure(code: "canceled", text: "sign-in canceled")
            }
            Thread.sleep(forTimeInterval: 1)
            st = Tailscale.current()
        }
        throw IDevice.Failure(code: "timeout", text: "the sign-in didn't finish in 10 minutes")
    }

    /// RemotePairing's handshake to this phone's own Tailscale address, through the tailnet.
    static func test(verify: Bool = false) throws -> Any? {
        guard Tailscale.node != nil else { throw IDevice.Failure(code: "not_signed_in", text: "sign in to Tailscale first") }
        guard let own = Tailscale.ownAddress() else { return ["ok": false, "code": "no_interface"] }
        defer { Tailscale.stop() }
        let st = Tailscale.start()
        if let e = st["error"] as? String, !e.isEmpty { return ["ok": false, "code": "not_running", "detail": e] }
        if st["state"] as? String == "Running" { Tailscale.remember(st) }
        // B220: the port RemotePairing listens on now (it isn't always 49152); every advertised port refused means
        // this phone no longer serves the pairing: the page says to pair again.
        let port: UInt16
        do { port = try IDevice.findRemotePairingPort { Tailscale.probe($0, host: own) } } catch let e as IDevice.Failure where e.code == "refused" {
            Tailscale.log("test \(own): \(e.text)")
            return ["ok": false, "code": "refused", "detail": e.text, "address": own, "name": st["name"] ?? NSNull()]
        }
        let h = strdup(own); defer { free(h) }
        var r = Tailscale.json(TSTest(h, Int32(port)))
        r["address"] = own
        r["name"] = st["name"] ?? NSNull()
        // B246: remotepairingd accepts the connection and then resets it when this phone has no paired host at all
        // ("Rejecting TCP control channel connection … not enabled", seen on the iPhone 15 Pro over Tailscale): the
        // route works, the pairing is missing. Not "No Answer": the page says to pair (`paired`: whether this app
        // still holds a pairing the phone has forgotten).
        if r["code"] as? String == "no_answer", (r["detail"] as? String)?.contains("reset by peer") == true {
            r["code"] = "not_paired"
            r["paired"] = IDevice.pairing() != nil
        }
        // B274: reaching RemotePairing isn't proof the phone still accepts this app's pairing (R55: remotepairingd ran
        // verifyManualPairing and dropped the channel, while this test said Connected). With `verify` and a pairing
        // kept, it connects once with it through Tailscale (IDevice.verify) and answers `verify_failed` with the
        // shell's error in `detail` (the page words it: core/installroute.js verifyFailure).
        // No pairing kept: reaching the phone isn't "apps install over Tailscale" yet (the page's Not Paired Yet).
        if verify, r["ok"] as? Bool == true, IDevice.pairing() == nil {
            r["ok"] = false
            r["code"] = "not_paired"
            r["paired"] = false
        } else if verify, r["ok"] as? Bool == true, Tailscale.useForInstall() {
            do {
                _ = try IDevice.verify(tailscale: true)
                r["verified"] = true
            } catch {
                let d = (error as? IDevice.Failure)?.errorDescription ?? error.localizedDescription
                r["ok"] = false
                r["code"] = "verify_failed"
                r["detail"] = d
                r["paired"] = true
            }
        }
        Tailscale.log("test \(own):\(port): \(r)")
        return r
    }
}

/// B218: This iPhone's setup kept in the Keychain, so a reinstall, a re-sign or a fresh container (an account sign-in
/// after one) comes back as it was: the node's state file (its machine and node keys: the same device returns to the
/// tailnet instead of a new one each time), {name, keyExpiry}, Connect With and Install Apps With. This device only,
/// never in a backup, readable after the first unlock, as the account key (Account.swift). The Keychain outlives the
/// app's container while the signing team stays the same. Only Sign Out deletes the node's part, all of it but the
/// machine key (B301).
enum TailscaleKeep {
    static let service = "com.ryha.ifizbox.tailscale"
    static let stateAccount = "state", nodeAccount = "node", connectAccount = "connect", routeAccount = "route"
    static let stateFile = "tailscaled.state" // tsnet's FileStore in Server.Dir

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func read(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    /// nil deletes it. A failure is logged, never thrown: the container's copy still works until the next reinstall.
    static func write(_ account: String, _ data: Data?) {
        let q = query(account)
        guard let data = data else { SecItemDelete(q as CFDictionary); return }
        if read(account) == data { return }
        var st = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if st == errSecItemNotFound {
            var add = q
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            st = SecItemAdd(add as CFDictionary, nil)
        }
        if st != errSecSuccess { Tailscale.log("keychain refused \(account) (\(st))") }
    }

    static var stateURL: URL { Tailscale.stateDir.appendingPathComponent(stateFile) }

    /// After the node runs signed in: its state file (keys rotate on a new login) into the Keychain.
    static func keepState() {
        guard let d = try? Data(contentsOf: stateURL), !d.isEmpty else { return }
        write(stateAccount, d)
    }

    /// Before the node starts: no state file in the container (reinstalled, re-signed) but one kept, so it goes back.
    static func restoreState() {
        let url = stateURL
        guard !FileManager.default.fileExists(atPath: url.path), let d = read(stateAccount) else { return }
        do {
            try d.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            Tailscale.log("node state restored from the keychain")
        } catch { Tailscale.log("node state not restored: \(error)") }
    }

    static func keepNode(_ n: [String: Any]) {
        write(nodeAccount, try? JSONSerialization.data(withJSONObject: n))
    }

    /// At launch: {name, keyExpiry} and Connect With back into UserDefaults when the container lost them.
    static func restoreDefaults() {
        let ud = UserDefaults.standard
        if ud.dictionary(forKey: Tailscale.nodeKey) == nil, read(stateAccount) != nil, let d = read(nodeAccount),
           let n = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any], n["name"] is String {
            ud.set(n, forKey: Tailscale.nodeKey)
            Tailscale.log("signed-in node restored from the keychain")
        }
        if ud.string(forKey: Tailscale.connectKey) == nil, let d = read(connectAccount), let v = String(data: d, encoding: .utf8),
           ["auto", "localdevvpn", "tailscale"].contains(v) {
            ud.set(v, forKey: Tailscale.connectKey)
        }
    }

    /// `keepState`: the state account holds only the machine key now (keepMachineKeyOnly), so it stays.
    static func forgetNode(keepState: Bool = false) {
        if !keepState { write(stateAccount, nil) }
        write(nodeAccount, nil)
    }

    /// tsnet's FileStore key for the machine key (tailscale.com ipn.MachineKeyStateKey). Logout keeps it in the store
    /// and deletes only the login's profile (its node key); a Sign In with it is the same machine to the tailnet.
    static let machineKeyEntry = "_machinekey"

    /// B301, at Sign Out (the node stopped): the state file (or, with none in the container, the Keychain's copy) cut
    /// down to its machine key, written back to the container and the Keychain. False, with nothing written, when
    /// there is no machine key to keep: the caller deletes the state then.
    @discardableResult
    static func keepMachineKeyOnly() -> Bool {
        let url = stateURL
        guard let d = (try? Data(contentsOf: url)) ?? read(stateAccount),
              let all = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let key = all[machineKeyEntry] as? String, !key.isEmpty,
              let kept = try? JSONSerialization.data(withJSONObject: [machineKeyEntry: key]) else { return false }
        do {
            try kept.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            Tailscale.log("machine key not kept: \(error)")
            return false
        }
        write(stateAccount, kept)
        Tailscale.log("signed out; machine key kept for the next sign-in")
        return true
    }
}
