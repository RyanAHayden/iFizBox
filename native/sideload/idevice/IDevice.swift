// The "no server" install route (docs/sideload.md, "idevice"): the app talks to this phone's own installd through
// idevice (MIT, built from source by build.sh beside this file) as if it were a computer on USB. The phone is
// reached at LocalDevVPN's loopback address, 10.7.0.1:
//   - iOS 17.4+ (and iOS 27, where lockdown's 62078 is refused over loopback): the RemotePairing service on 49152,
//     an RPPairing tunnel (tunnel_create_rppairing) and RSD, with a RemotePairing pairing made on the phone
//     (pairable host: Settings > Developer > Pair with <app> on this iPhone, a 6-digit code).
//   - older iOS: plain TCP lockdown on 62078 with a pairing file made on a computer (idevice_pair, jitterbugpair)
//     and imported, plus a heartbeat while it is connected.
// Install: AFC writes the signed IPA to PublicStaging, then installation_proxy installs it with progress. No
// itms-services manifest, so nothing goes to the Signing Server, and the app can update itself (installd closes it).
// The pairing is a full credential for the phone: it lives in the Keychain, this device only.
import Darwin
import dnssd
import Foundation
import IDeviceFFI
import os
import Security
import UIKit

enum IDevice {
    static let address = "10.7.0.1" // LocalDevVPN's loopback; the phone itself
    static let lockdownPort: UInt16 = 62078
    // The RemotePairing service. iOS advertises it over mDNS (_remotepairing._tcp); 49152 is the port it had on the
    // iPhone 15 (iOS 27.0.1) for every probe (journal/2026-11-19-f15-idevice-install/notes.md).
    static let remotePairingPort: UInt16 = 49152
    static let stagingDir = "/PublicStaging"
    static let queue = DispatchQueue(label: "ifizbox.idevice", qos: .userInitiated)

    struct Failure: LocalizedError {
        let code: String, text: String
        var lib: Int32? = nil // idevice's error code, when idevice gave the error (HereRecheck.droppedCodes)
        var errorDescription: String? { "\(code): \(text)" }
        /// B246: the connection to iOS went away (a drop or the watchdog's timeout), not an answer from iOS.
        var dropped: Bool { HereRecheck.isDropped(code: code, lib: lib) }
    }

    /// Throws idevice's error (and frees it). `code` is the bridge-facing prefix for this step.
    static func check(_ err: UnsafeMutablePointer<IdeviceFfiError>?, _ code: String) throws {
        guard let err = err else { return }
        let msg = err.pointee.message.map { String(cString: $0) } ?? "error \(err.pointee.code)"
        let n = err.pointee.code
        idevice_error_free(err)
        throw Failure(code: code, text: "\(msg) (\(n))", lib: n)
    }

    // ---- The pairing, in the Keychain

    enum Kind: String { case remotePairing = "rp", lockdown }

    private static let service = "ifizbox.idevice.pairing"

    static func savePairing(_ data: Data, kind: Kind) throws {
        for k in [Kind.remotePairing, .lockdown] { deletePairing(k) } // one pairing at a time
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: kind.rawValue, kSecValueData as String: data,
                                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let st = SecItemAdd(q as CFDictionary, nil)
        guard st == errSecSuccess else { throw Failure(code: "keychain", text: "could not keep the pairing (\(st))") }
    }

    static func pairing() -> (kind: Kind, data: Data)? {
        for k in [Kind.remotePairing, .lockdown] {
            let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: k.rawValue, kSecReturnData as String: true]
            var out: CFTypeRef?
            if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data { return (k, d) }
        }
        return nil
    }

    static func deletePairing(_ kind: Kind) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                       kSecAttrAccount as String: kind.rawValue] as CFDictionary)
    }

    /// Which kind of pairing a file is: a lockdown pairing record (idevice_pair, jitterbugpair: a plist with
    /// HostCertificate/HostPrivateKey) or a RemotePairing one (idevice's rp_pairing_file). Checked by idevice itself.
    static func importPairing(_ data: Data) throws -> Kind {
        let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        if plist?["HostCertificate"] != nil {
            var pf: OpaquePointer?
            try data.withUnsafeBytes { try check(idevice_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &pf), "bad_pairing") }
            idevice_pairing_file_free(pf)
            try savePairing(data, kind: .lockdown)
            return .lockdown
        }
        var rp: OpaquePointer?
        try data.withUnsafeBytes { try check(rp_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &rp), "bad_pairing") }
        rp_pairing_file_free(rp)
        try savePairing(data, kind: .remotePairing)
        return .remotePairing
    }

    // ---- Pairing on the phone (iOS 27): this app is the "computer" the phone pairs with
    //
    // idevice generates the host identity and TXT records (pairable_host_prepare) and runs the pairing on a socket
    // the phone has connected to (pairable_host_accept_fd); the networking is Apple's. A dual-stack listener on every
    // interface, published with DNSServiceRegister, so mDNSResponder advertises its own host name and the addresses
    // the phone's remotepairingdeviced can reach (loopback included). idevice's all-in-one pairable_host_accept
    // binds IPv4 only and answers mDNS itself (mdns-sd, an "idevice-XXXX.local." host): on the iPhone 15 Pro (iOS
    // 27.0.1) the phone resolved it but its connection stalled and never reached the listener (SYN in: 0).

    static let pairableHostService = "_remotepairing-pairable-host._tcp" // idevice's PAIRABLE_HOST_SERVICE_TYPE

    /// Ends a waiting pairOnPhone from any thread: stops accepting and shuts down a pairing in progress.
    final class PairCancel {
        private let lock = NSLock()
        private var canceled = false
        private var conn: Int32 = -1
        var isCanceled: Bool { lock.lock(); defer { lock.unlock() }; return canceled }
        func signal() {
            lock.lock(); canceled = true; let fd = conn; lock.unlock()
            if fd >= 0 { shutdown(fd, SHUT_RDWR) } // wakes idevice's read on its dup of this socket
        }
        fileprivate func track(_ fd: Int32) -> Bool {
            lock.lock(); defer { lock.unlock() }
            conn = fd
            return !canceled
        }
    }

    /// What pairOnPhone tells the page while it waits.
    enum PairEvent { case step(String, String), failed(String, String), pin(String) }

    // os_log, public: NSLog's lines never reached the syslog relay on iOS 27 (f15pair2), and os_log redacts a
    // dynamic string as <private> unless it is marked public.
    private static let pairLog = OSLog(subsystem: "ifizbox.idevice", category: "pair")
    static func log(_ s: String) { os_log("%{public}@", log: pairLog, type: .default, "\(Brand.name) pair: \(s)") }

    /// The 6-digit code for one pairing: made before anything listens, shown at once, and used by every try.
    static func newPairingCode() -> String { String(format: "%06d", Int.random(in: 0..<1_000_000)) }

    private final class PinBox { let show: (String) -> Void; init(_ f: @escaping (String) -> Void) { show = f } }

    private final class RegBox {
        let done = DispatchSemaphore(value: 0)
        var err: DNSServiceErrorType = 0
        var name = ""
        var signalled = false
    }

    /// Advertises the app as a pairable host and waits (blocking; call it on `queue`) until the phone pairs, the
    /// user cancels, or it fails. `code` (newPairingCode) is the 6-digit code pair-setup uses on every try, so the
    /// page shows it before the phone connects. `event` gets the steps and a failed try (the phone can try again).
    static func pairOnPhone(code: String, cancel: PairCancel, event: @escaping (PairEvent) -> Void) throws {
        // 1. The identity and what to publish
        var handle: OpaquePointer?
        var sid: UnsafeMutablePointer<CChar>?
        var txtPtr: UnsafeMutablePointer<UInt8>?
        var txtLen: UInt = 0
        try check(pairable_host_prepare(Brand.name, nil, false, &handle, &sid, &txtPtr, &txtLen, nil), "pair_failed")
        defer { pairable_host_free(handle) }
        // Our code, not one idevice draws after the phone connects (patches/0001: pairable_host_set_pin)
        try check(pairable_host_set_pin(handle, code), "pair_failed")
        let serviceID = sid.map { String(cString: $0) } ?? ""
        if let sid = sid { idevice_string_free(sid) }
        let txtPlist = txtPtr.map { Data(bytes: $0, count: Int(txtLen)) } ?? Data()
        if let t = txtPtr { idevice_data_free(t, txtLen) }
        guard let txt = (try? PropertyListSerialization.propertyList(from: txtPlist, format: nil)) as? [String: String] else {
            throw Failure(code: "pair_failed", text: "idevice gave no TXT records")
        }
        var record = Data() // DNS TXT: length-prefixed key=value strings
        for (k, v) in txt.sorted(by: { $0.key < $1.key }) {
            let kv = Data("\(k)=\(v)".utf8).prefix(255)
            record.append(UInt8(kv.count)); record.append(kv)
        }
        log("identity \(serviceID), TXT keys \(txt.keys.sorted().joined(separator: ","))")

        // 2. The listener: IPv6 socket that takes IPv4 too, every interface, a free port
        let lfd = socket(AF_INET6, SOCK_STREAM, IPPROTO_TCP)
        guard lfd >= 0 else { throw Failure(code: "pair_failed", text: "socket: \(String(cString: strerror(errno)))") }
        defer { close(lfd) }
        var off: Int32 = 0, on: Int32 = 1
        setsockopt(lfd, IPPROTO_IPV6, IPV6_V6ONLY, &off, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))
        var any = sockaddr_in6()
        any.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
        any.sin6_family = sa_family_t(AF_INET6)
        any.sin6_addr = in6addr_any
        let bound = withUnsafePointer(to: &any) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(lfd, $0, socklen_t(MemoryLayout<sockaddr_in6>.size)) } }
        guard bound == 0, listen(lfd, 4) == 0 else { throw Failure(code: "pair_failed", text: "listen: \(String(cString: strerror(errno)))") }
        var got = sockaddr_in6(); var gl = socklen_t(MemoryLayout<sockaddr_in6>.size)
        _ = withUnsafeMutablePointer(to: &got) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(lfd, $0, &gl) } }
        let port = UInt16(bigEndian: got.sin6_port)
        log("listening on [::]:\(port) (IPv4 and IPv6, every interface); addresses: \(interfaceAddresses())")
        event(.step("listening", "Listening on port \(port)."))

        // 3. Bonjour, by mDNSResponder
        let reg = RegBox()
        let regCtx = Unmanaged.passRetained(reg)
        defer { regCtx.release() }
        var sdRef: DNSServiceRef?
        let cb: DNSServiceRegisterReply = { _, _, err, name, _, _, ctx in
            guard let ctx = ctx else { return }
            let r = Unmanaged<RegBox>.fromOpaque(ctx).takeUnretainedValue()
            r.err = err
            r.name = name.map { String(cString: $0) } ?? ""
            if !r.signalled { r.signalled = true; r.done.signal() }
        }
        let st = record.withUnsafeBytes { buf in
            DNSServiceRegister(&sdRef, 0, 0, serviceID, pairableHostService, nil, nil, port.bigEndian,
                               UInt16(buf.count), buf.baseAddress, cb, regCtx.toOpaque())
        }
        guard st == kDNSServiceErr_NoError, let sd = sdRef else {
            log("DNSServiceRegister failed: \(st)")
            throw Failure(code: "pair_failed", text: bonjourError(st))
        }
        let bq = DispatchQueue(label: "ifizbox.idevice.bonjour")
        defer { bq.sync { DNSServiceRefDeallocate(sd) } } // on its queue: no callback runs after this
        DNSServiceSetDispatchQueue(sd, bq)
        if reg.done.wait(timeout: .now() + 10) == .timedOut {
            log("Bonjour: no answer from mDNSResponder in 10 s; still waiting for the iPhone")
        } else {
            let err = bq.sync { reg.err }
            guard err == kDNSServiceErr_NoError else {
                log("Bonjour registration failed: \(err)")
                throw Failure(code: "pair_failed", text: bonjourError(err))
            }
            log("Bonjour: registered \(bq.sync { reg.name }).\(pairableHostService) port \(port), every interface")
        }
        event(.step("advertised", "Waiting for the iPhone to connect (port \(port))."))

        // 4. Accept: one try at a time; a failed try keeps listening, so Pair can be tapped again on the phone
        let box = Unmanaged.passRetained(PinBox { event(.pin($0)) })
        defer { box.release() }
        let pinCb: @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void = { p, ctx in
            guard let p = p, let ctx = ctx else { return }
            IDevice.log("pair-setup started; the phone asks for the code")
            Unmanaged<PinBox>.fromOpaque(ctx).takeUnretainedValue().show(String(cString: p))
        }
        while !cancel.isCanceled {
            var pfd = pollfd(fd: lfd, events: Int16(POLLIN), revents: 0)
            let n = poll(&pfd, 1, 250)
            if n < 0 && errno != EINTR { throw Failure(code: "pair_failed", text: "poll: \(String(cString: strerror(errno)))") }
            guard n > 0 else { continue }
            var peer = sockaddr_storage(); var pl = socklen_t(MemoryLayout<sockaddr_storage>.size)
            let cfd = withUnsafeMutablePointer(to: &peer) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { accept(lfd, $0, &pl) } }
            guard cfd >= 0 else { log("accept failed: \(String(cString: strerror(errno)))"); continue }
            let from = numericHost(&peer, pl)
            log("connection from \(from)")
            event(.step("connected", "The iPhone connected. Pairing…"))
            guard cancel.track(cfd) else { close(cfd); break }
            var out: OpaquePointer?
            let err = pairable_host_accept_fd(handle, cfd, pinCb, box.toOpaque(), nil, &out)
            _ = cancel.track(-1)
            close(cfd)
            do {
                try check(err, "pair_failed")
                defer { rp_pairing_file_free(out) }
                try savePairing(try bytes(out), kind: .remotePairing)
                log("paired; the pairing is saved")
                return
            } catch let e as Failure {
                if cancel.isCanceled { break }
                log("pairing with \(from) failed: \(e.text)")
                event(.failed("pairing", e.text))
            }
        }
        log("canceled")
        throw Failure(code: "canceled", text: "pairing stopped")
    }

    private static func bonjourError(_ e: DNSServiceErrorType) -> String {
        if e == kDNSServiceErr_NoAuth || e == kDNSServiceErr_PolicyDenied {
            return "Local Network access is off for this app: turn it on in Settings > Privacy & Security > Local Network (Bonjour error \(e))"
        }
        return "could not advertise on the local network (Bonjour error \(e))"
    }

    private static func numericHost(_ ss: UnsafeMutablePointer<sockaddr_storage>, _ len: socklen_t) -> String {
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST)), serv = [CChar](repeating: 0, count: Int(NI_MAXSERV))
        let r = ss.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            getnameinfo($0, len, &host, socklen_t(host.count), &serv, socklen_t(serv.count), NI_NUMERICHOST | NI_NUMERICSERV)
        }
        return r == 0 ? "\(String(cString: host)) port \(String(cString: serv))" : "?"
    }

    /// This phone's interfaces and addresses, for the log ("lo0 127.0.0.1, en0 fe80::…, utun4 10.7.0.0").
    static func interfaceAddresses() -> String {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return "?" }
        defer { freeifaddrs(list) }
        var out: [String] = []
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            guard let a = p.pointee.ifa_addr, (p.pointee.ifa_flags & UInt32(IFF_UP)) != 0 else { continue }
            let fam = Int32(a.pointee.sa_family)
            guard fam == AF_INET || fam == AF_INET6 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let len = socklen_t(fam == AF_INET ? MemoryLayout<sockaddr_in>.size : MemoryLayout<sockaddr_in6>.size)
            if getnameinfo(a, len, &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                out.append("\(String(cString: p.pointee.ifa_name)) \(String(cString: host))")
            }
        }
        return out.joined(separator: ", ")
    }

    private static func bytes(_ rp: OpaquePointer?) throws -> Data {
        var p: UnsafeMutablePointer<UInt8>?
        var n: UInt = 0
        try check(rp_pairing_file_to_bytes(rp, &p, &n), "pair_failed")
        defer { idevice_data_free(p, n) }
        return p.map { Data(bytes: $0, count: Int(n)) } ?? Data()
    }

    // ---- Logging and time limits for connecting and installing
    //
    // One os_log line per step (subsystem ifizbox.idevice, category install), public, so the syslog relay shows it
    // (NSLog never reached it on iOS 27). idevice's own log (Info: no keys, no payloads) goes to Caches/idevice.log;
    // its last lines are copied into os_log when a step fails or stops answering.
    //
    // No idevice call has a read timeout (its 5 s limit covers TCP connects only), so a phone that stops answering
    // left the install waiting for ever (f15pair4, 2026-11-19: the tunnel stayed up, 14.4 MB went over it, then only
    // empty TCP segments, and the page never got an error). Every step now runs under a Watch: the work runs on its
    // own thread, and when a step goes quiet past its limit the tunnel is closed (adapter_close on a clone), which
    // makes idevice's waiting read fail, and the install fails with what stopped.

    private static let installLog = OSLog(subsystem: "ifizbox.idevice", category: "install")
    static func ilog(_ s: String) { os_log("%{public}@", log: installLog, type: .default, "\(Brand.name) install: \(s)") }

    static let libraryLogURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("idevice.log")
    private static let libraryLogStarted: Bool = {
        var path = Array(libraryLogURL.path.utf8CString)
        let r = path.withUnsafeMutableBufferPointer { idevice_init_logger(Disabled, Info, $0.baseAddress) }
        ilog("idevice log: \(libraryLogURL.path) (\(r))")
        return true
    }()

    /// The last lines of idevice's own log, into os_log (after a failure).
    static func relayLibraryLog(_ lines: Int = 30) {
        guard let fh = try? FileHandle(forReadingFrom: libraryLogURL) else { return }
        defer { try? fh.close() }
        let end = (try? fh.seekToEnd()) ?? 0
        try? fh.seek(toOffset: end > 8192 ? end - 8192 : 0)
        let text = String(decoding: (try? fh.readToEnd()) ?? Data(), as: UTF8.self)
        for line in text.split(separator: "\n").suffix(lines) { ilog("idevice: \(line)") }
    }

    /// Time limits, in seconds. A step fails when nothing moved for its limit; progress (an uploaded chunk, an
    /// installd percentage) starts the clock again.
    enum Limit {
        static let tunnel: TimeInterval = 30   // RPPairing verify, the tunnel, the RSD handshake (or lockdown)
        static let service: TimeInterval = 20  // connecting to AFC or installation_proxy through RSD
        static let afcStep: TimeInterval = 20  // one AFC request (mkdir, open, close, remove)
        static let upload: TimeInterval = HereRecheck.CopyQuiet.ceiling // one 1 MB chunk; B292: shorter once chunks land fast
        static let install: TimeInterval = 180 // installd's next percentage (a big app verifies for a while)
        static let grace: TimeInterval = 10    // after closing the tunnel, for the stuck call to come back
    }

    /// The step running now and when it last moved; the watchdog's view of the work thread.
    final class Watch {
        private let lock = NSLock()
        private var step = "starting", limit = Limit.tunnel, last = Date()
        private var closer: OpaquePointer? // an AdapterHandle clone, only for adapter_close; freed here
        private(set) var detail = ""
        // B251: called by the watchdog with the step's quiet seconds, for this step only (begin clears it)
        private var quietHook: ((TimeInterval) -> Void)?
        private var stepNo = 0
        private var stopWhy: String? // set: the watchdog ends the step now (a second look found the work done)

        func begin(_ s: String, _ l: TimeInterval) {
            lock.lock(); step = s; limit = l; last = Date(); quietHook = nil; stepNo += 1; lock.unlock()
            IDevice.ilog("step: \(s) (limit \(Int(l)) s)")
        }
        /// B251: `f` gets the quiet seconds on every watchdog tick while the current step runs; it must not block.
        /// Returns the step's number, for stop(_:step:).
        func whileQuiet(_ f: @escaping (TimeInterval) -> Void) -> Int {
            lock.lock(); defer { lock.unlock() }
            quietHook = f
            return stepNo
        }
        var hook: ((TimeInterval) -> Void)? { lock.lock(); defer { lock.unlock() }; return quietHook }
        /// B251: ends step `n` now, if it is still the step running: `then` runs first, under the lock, so whatever
        /// it records is there before the watchdog acts. False when the step already ended.
        func stop(_ why: String, step n: Int, then: () -> Void) -> Bool {
            lock.lock(); defer { lock.unlock() }
            guard n == stepNo, stopWhy == nil else { return false }
            then()
            stopWhy = why
            return true
        }
        var stopRequest: String? { lock.lock(); defer { lock.unlock() }; return stopWhy }
        func alive(_ d: String? = nil) { lock.lock(); last = Date(); if let d = d { detail = d }; lock.unlock() }
        /// B292: a new quiet limit for the step running now (the copy's, from how fast chunks land).
        func setLimit(_ l: TimeInterval) { lock.lock(); limit = l; lock.unlock() }
        /// B292: how often the watchdog saw the app suspended; the copy leaves such gaps out of its pace.
        private var suspendedCount = 0
        func noteSuspended() { lock.lock(); suspendedCount += 1; lock.unlock() }
        var suspensions: Int { lock.lock(); defer { lock.unlock() }; return suspendedCount }
        var now: (step: String, limit: TimeInterval, quiet: TimeInterval) {
            lock.lock(); defer { lock.unlock() }
            return (step, limit, Date().timeIntervalSince(last))
        }
        func setCloser(_ a: OpaquePointer?) { lock.lock(); closer = a; lock.unlock() }
        /// Shuts the tunnel's TCP stack down: every read waiting on it fails at once.
        func closeTunnel() -> Bool {
            lock.lock(); defer { lock.unlock() }
            guard let c = closer else { return false }
            adapter_close(c).map(idevice_error_free)
            return true
        }
        func releaseCloser() {
            lock.lock(); let c = closer; closer = nil; lock.unlock()
            if let c = c { adapter_free(c) }
        }
    }

    private final class Outcome<T> {
        let done = DispatchSemaphore(value: 0)
        var result: Result<T, Error>?
    }

    /// Runs `body` on its own thread under a Watch and waits for it, at most each step's limit of quiet. A step that
    /// overruns closes the tunnel and throws "timeout: <step> …"; if the call still doesn't come back, its thread is
    /// left with everything it holds (nothing is freed under it).
    static func watched<T>(_ what: String, _ body: @escaping (Watch) throws -> T) throws -> T {
        _ = libraryLogStarted
        let w = Watch(), out = Outcome<T>()
        let t0 = Date()
        let th = Thread {
            do { out.result = .success(try body(w)) } catch { out.result = .failure(error) }
            out.done.signal()
        }
        th.stackSize = 4 << 20 // idevice runs its futures on this thread (block_on)
        th.qualityOfService = .userInitiated // B246: as IDevice.queue, so leaving the app doesn't demote the copy
        th.start()
        var tick = Date()
        while out.done.wait(timeout: .now() + 0.5) == .timedOut {
            // B246: a wait that took far longer than 0.5 s means iOS suspended the app (it left the front without
            // KeepAlive holding it). The step's clock starts again: its call gets its whole limit after the app is
            // back, rather than a timeout for the time nothing here could run.
            let gap = Date().timeIntervalSince(tick)
            tick = Date()
            if gap > 5 {
                ilog("the app was suspended for \(Int(gap)) s (\(AppFront.now ? "in front" : "in the background") now); \(w.now.step) gets its time again")
                w.alive()
                w.noteSuspended()
                continue
            }
            if let why = w.stopRequest {
                // B251: the work is done elsewhere (a second look); the call still waits on the first connection
                ilog("ending \(w.now.step): \(why); closing the tunnel")
                let closed = w.closeTunnel()
                if out.done.wait(timeout: .now() + Limit.grace) == .timedOut {
                    ilog("the waiting call didn't come back (tunnel closed: \(closed)); leaving it")
                } else if case .success(let v)? = out.result {
                    ilog("\(what): done in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s (finished on its own)")
                    return v
                }
                throw Failure(code: "stopped", text: why)
            }
            let n = w.now
            w.hook?(n.quiet)
            guard n.quiet > n.limit else { continue }
            let why = "\(n.step): no answer from iOS for \(Int(n.limit)) s" + (w.detail.isEmpty ? "" : " (\(w.detail))")
            ilog("TIMEOUT \(why); closing the tunnel")
            let closed = w.closeTunnel()
            if out.done.wait(timeout: .now() + Limit.grace) == .timedOut {
                ilog("the stuck call didn't come back (tunnel closed: \(closed)); leaving it")
            } else if case .failure(let e)? = out.result {
                ilog("the stuck call ended with: \(e.localizedDescription)")
            }
            relayLibraryLog()
            throw Failure(code: "timeout", text: "\(why). Check that LocalDevVPN (or Tailscale) is on, then try again")
        }
        switch out.result! {
        case .success(let v):
            ilog("\(what): done in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s")
            return v
        case .failure(let e):
            ilog("\(what): FAILED at \(w.now.step) after \(String(format: "%.1f", Date().timeIntervalSince(t0))) s: \((e as? Failure)?.errorDescription ?? e.localizedDescription)")
            relayLibraryLog()
            throw e
        }
    }

    /// B246: whether the app is in front, readable from any thread (for the copy's speed in the log and on the page,
    /// and the watchdog's suspension note).
    enum AppFront {
        private static let lock = NSLock()
        private static var front = true
        private static var watching = false
        static var now: Bool { lock.lock(); defer { lock.unlock() }; return front }
        private static func set(_ f: Bool) { lock.lock(); front = f; lock.unlock() }

        /// Starts following the app's state; call it on the main thread (idempotent).
        static func watch() {
            guard !watching else { return }
            watching = true
            set(UIApplication.shared.applicationState != .background)
            let nc = NotificationCenter.default
            nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { _ in
                set(false); IDevice.ilog("the app went to the background")
            }
            nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { _ in
                set(true); IDevice.ilog("the app is in front again")
            }
        }
    }

    /// B246: install() connects again after a drop and carries on where the last try stopped.
    private final class HereRun {
        let ipa: URL, size: Int, remote: String, bundleID: String?, version: String?
        var connected = false   // the first try got as far as a session: later drops are worth connecting again
        var tailnet: Bool?      // the route the first session took; later tries keep it
        var before: HereRecheck.Before?  // what iOS listed before the install; nil until asked
        var sent = 0            // bytes of the IPA iOS has
        var copied = false      // the whole IPA is in PublicStaging
        var speed = HereRecheck.CopySpeed()
        var copyStart: Date?
        var lastLanded: Date?   // B293: when the last chunk landed, kept across reconnects for the speed summary
        var installSent = false // installation_proxy got the install
        var askUntil: Date?     // after a drop, how long to keep asking iOS for the app (one deadline per install)
        var lookedInstalled = false // B251: a second look found the new copy while installd's step was quiet
        init(ipa: URL, size: Int, remote: String, bundleID: String?, version: String?) {
            self.ipa = ipa; self.size = size; self.remote = remote; self.bundleID = bundleID; self.version = version
        }
    }

    // ---- B220: which port RemotePairing listens on
    //
    // remotepairingd's port isn't fixed: 49152 is the first port of iOS's dynamic range, which it gets when it starts
    // early, and a restart (the phone's or the service's) can leave it elsewhere. Every connect to 49152 was then
    // refused while the app said the pairing was fine. The service is advertised over mDNS (_remotepairing._tcp), as
    // idevice's own pair_rsd_ios finds it. The port that worked last is tried first, then 49152, then every advertised
    // port; a probe on 10.7.0.1 (or the phone's Tailscale address) picks the one this phone answers on (another
    // device's advertised port is refused here, so it costs a millisecond). Every port refused means nothing serves
    // RemotePairing for this pairing any more (the phone dropped it): code "refused", and the page pairs again.

    static let remotePairingService = "_remotepairing._tcp"
    // The port that answered last, for this run of the app only (nothing of the route is kept outside the Keychain).
    private static let portLock = NSLock()
    private static var lastPort: UInt16?
    static var lastRemotePairingPort: UInt16? {
        get { portLock.lock(); defer { portLock.unlock() }; return lastPort }
        set { portLock.lock(); lastPort = newValue; portLock.unlock() }
    }

    /// The ports to try, in order, before the advertised ones: the last good one, then 49152.
    static func knownRemotePairingPorts() -> [UInt16] {
        var out: [UInt16] = []
        for p in [lastRemotePairingPort, remotePairingPort].compactMap({ $0 }) where !out.contains(p) { out.append(p) }
        return out
    }

    /// The port this phone answers RemotePairing on, by `probe` (a TCP connect over the route in use). Throws
    /// "refused" when every candidate refused; otherwise the first port that didn't answer (a refused one can't be
    /// it), and the connect says what's wrong (the VPN off, a tailnet rule). Blocking.
    static func findRemotePairingPort(via: String = "the VPN", probe: (UInt16) -> VPNCheck.Probe) throws -> UInt16 {
        var tried: [UInt16] = [], refused: [UInt16] = [], silent: [UInt16] = []
        func attempt(_ ports: [UInt16]) -> UInt16? {
            for p in ports where !tried.contains(p) {
                tried.append(p)
                switch probe(p) {
                case .connected: return p
                case .refused: refused.append(p)
                case .silent: silent.append(p)
                }
            }
            return nil
        }
        let known = knownRemotePairingPorts()
        var found = attempt(known)
        if found == nil {
            let advertised = advertisedRemotePairingPorts()
            ilog("RemotePairing: \(known.map(String.init).joined(separator: ", ")) didn't answer; advertised: \(advertised.isEmpty ? "none" : advertised.map(String.init).joined(separator: ", "))")
            found = attempt(advertised)
        }
        if let p = found {
            if p != lastRemotePairingPort { lastRemotePairingPort = p; ilog("RemotePairing is on port \(p)") }
            return p
        }
        // A port that didn't answer may still be the one (a slow route); one that refused isn't
        if let p = silent.first { return p }
        // B316: lockdownd (62078) listens whatever app is paired. When it refuses too, the route turns every connection
        // down (the user's phone over Tailscale on cellular refused 49152 and 62078 alike, while the desktop reached
        // the 15's on Wi-Fi), and pairing again can't help: "route_refused", with the route named.
        let control = probe(lockdownPort)
        ilog("RemotePairing refused on \(refused.map(String.init).joined(separator: ", ")); lockdown's \(lockdownPort) through \(via): \(control)")
        if control == .refused {
            throw Failure(code: "route_refused", text: "this iPhone refused every connection through \(via), lockdown's port \(lockdownPort) too, so it isn't the pairing")
        }
        throw Failure(code: "refused", text: "this iPhone refused RemotePairing on port \(refused.map(String.init).joined(separator: ", ")): it no longer has this pairing. Pair again")
    }

    private final class BrowseBox {
        let lock = NSLock()
        var ports: [UInt16] = []
        var refs: [DNSServiceRef] = [] // the resolves under way, freed with the browse
        var error: DNSServiceErrorType = 0
        let queue = DispatchQueue(label: "ifizbox.idevice.browse") // every callback runs here
    }

    private static let resolvedReply: DNSServiceResolveReply = { _, _, _, err, _, _, port, _, _, c in
        guard err == kDNSServiceErr_NoError, let c = c else { return }
        let b = Unmanaged<BrowseBox>.fromOpaque(c).takeUnretainedValue()
        let p = UInt16(bigEndian: port)
        b.lock.lock(); if p > 0, !b.ports.contains(p) { b.ports.append(p) }; b.lock.unlock()
    }

    /// The ports _remotepairing._tcp is advertised on (this phone's own service among them), gathered for `wait`
    /// seconds. Needs Local Network access and the type in Info-sideload.plist's NSBonjourServices; [] without them.
    static func advertisedRemotePairingPorts(wait: TimeInterval = 2) -> [UInt16] {
        let box = BrowseBox()
        let ctx = Unmanaged.passRetained(box)
        defer { ctx.release() }
        let q = box.queue
        var browse: DNSServiceRef?
        let found: DNSServiceBrowseReply = { _, flags, iface, err, name, type, domain, c in
            guard let c = c else { return }
            let b = Unmanaged<BrowseBox>.fromOpaque(c).takeUnretainedValue()
            guard err == kDNSServiceErr_NoError else { b.error = err; return }
            guard flags & DNSServiceFlags(kDNSServiceFlagsAdd) != 0, let name = name, let type = type, let domain = domain else { return }
            var r: DNSServiceRef?
            guard DNSServiceResolve(&r, 0, iface, name, type, domain, IDevice.resolvedReply, c) == kDNSServiceErr_NoError, let ref = r else { return }
            DNSServiceSetDispatchQueue(ref, b.queue)
            b.refs.append(ref)
        }
        let st = DNSServiceBrowse(&browse, 0, 0, remotePairingService, nil, found, ctx.toOpaque())
        guard st == kDNSServiceErr_NoError, let br = browse else {
            ilog("RemotePairing browse failed: \(st)")
            return []
        }
        DNSServiceSetDispatchQueue(br, q)
        Thread.sleep(forTimeInterval: wait)
        q.sync { // on its queue: no callback runs after this
            for r in box.refs { DNSServiceRefDeallocate(r) }
            box.refs = []
            DNSServiceRefDeallocate(br)
        }
        if box.error != 0 { ilog("RemotePairing browse: error \(box.error)") }
        box.lock.lock(); defer { box.lock.unlock() }
        return box.ports
    }

    /// B220: a failed RemotePairing connect, by what it means for the page: "refused" (nothing listens: the pairing
    /// is gone from the phone) and "pairing_rejected" (the phone answered but turned the pairing down) both mean
    /// pair again; anything else stays connect_failed (the VPN, the network).
    static func connectFailure(_ e: Failure) -> Failure {
        let t = e.text
        if t.contains("RemotePairing(") || t.contains("PairVerifyFailed") || t.contains("Pairing rejected") {
            return Failure(code: "pairing_rejected", text: "this iPhone didn't accept the pairing (\(t)). Pair again")
        }
        if t.localizedCaseInsensitiveContains("connection refused") {
            return Failure(code: "refused", text: "this iPhone refused the connection (\(t)): it no longer has this pairing. Pair again")
        }
        return e
    }

    /// B274: the phone took the TCP connection, then reset the RemotePairing channel during pair-verify (idevice's
    /// Socket(UnexpectedEof "early eof") from tunnel_create_rppairing; remotepairingd's verifyManualPairing dropping
    /// it, R55 on the iPhone 15 Pro): a pairing it no longer accepts. Matched as the page does (core/installroute.js
    /// earlyEOF). Not folded into connectFailure: on a reconnect mid-install it stays a drop that is tried again.
    static func isEarlyEOF(_ e: Failure) -> Bool {
        e.code == "connect_failed" && (e.text.contains("UnexpectedEof") || e.text.localizedCaseInsensitiveContains("early eof"))
    }

    /// B274: the install's first connect ending in isEarlyEOF, in the words Check Connection uses for it (Pair Again).
    static func pairAgain(_ e: Failure, via: String) -> Failure {
        Failure(code: "pair_again", text: "this iPhone answered through \(via), then closed the connection: it no longer accepts \(Brand.name)'s pairing. Pair again in Settings > Installation", lib: e.lib)
    }

    // ---- Connecting

    static func sockaddr4(_ port: UInt16, host: String = address) -> sockaddr_in {
        var a = sockaddr_in()
        a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        a.sin_family = sa_family_t(AF_INET)
        a.sin_port = port.bigEndian
        inet_pton(AF_INET, host, &a.sin_addr)
        return a
    }

    /// One connection to the phone's services, over whichever route the stored pairing is for. Made and used on the
    /// one thread `watched` runs (idevice's handles aren't thread safe); only the Watch's adapter clone is touched
    /// from the watchdog.
    ///
    /// RemotePairing (the order idevice's own pair_rsd_ios tool and StikDebug use): tunnel_create_rppairing does the
    /// TCP connect to 49152, pair-verify, createListener, the TLS-PSK tunnel on the port the phone answers, and the
    /// RSD handshake to the RSD port the tunnel's handshake names, all through idevice's userspace TCP stack (jktcp)
    /// to the tunnel's server address (fd4f:…::1), not the OS network. The adapter's I/O task keeps running on
    /// idevice's multi-thread runtime after the call returns, for as long as `adapter` (or a clone) lives. The
    /// RPPairing control connection is dropped when the call returns ("host disconnected" in remotepairingdeviced's
    /// log): the tunnel stays up without it (its stats go on every 30 s), as for every idevice user.
    final class Session {
        private var provider: OpaquePointer? // lockdown: IdeviceProviderHandle
        private var adapter: OpaquePointer?  // RemotePairing: AdapterHandle (the tunnel)
        private var handshake: OpaquePointer? // and its RsdHandshakeHandle
        private var heartbeat: OpaquePointer?
        private var beating = false
        private let watch: Watch
        private var viaTailscale = false
        private let pinnedTailscale: Bool? // B246: the route a reconnect must use (nil: Tailscale.useForInstall)
        private let second: Bool // B251: a second look beside the install's own session: shares its Tailscale relay
        let kind: Kind
        private var builtIn = false // F372: through the built-in VPN, held (LocalVPN.begin) until deinit
        private var dataOff = false // F372: Cellular Data Off ran for this connect; On runs once connected
        var via: String { builtIn ? LocalVPN.name : viaTailscale ? "Tailscale" : "LocalDevVPN" }
        var tailnet: Bool { viaTailscale }

        /// Where to connect for `port`: LocalDevVPN's 10.7.0.1, or (Tailscale.useForInstall) a 127.0.0.1 relay that
        /// reaches this phone's own Tailscale address over the app's tailnet node (native/sideload/tailscale).
        /// F372: the built-in VPN first, whenever this app can run it (LocalVPN.available): it turns on here and the
        /// connect goes to the same 10.7.0.1; Tailscale and LocalDevVPN are left for an app signed without it.
        private func endpoint(_ port: UInt16) throws -> (String, UInt16) {
            if LocalVPN.available && pinnedTailscale != true {
                if LocalVPN.failedNow() {
                    // B378: it failed a moment ago: the other ways in only when one is on, else the same error again
                    if !Session.otherRouteOn() { throw Session.lastVPNFailure() }
                } else {
                    if second || builtIn { return (address, port) } // a second look rides on the install's own session's VPN
                    watch.begin("turning on \(LocalVPN.name)", Limit.tunnel)
                    let w = watch
                    do {
                        dataOff = try LocalVPN.begin { w.alive($0) }
                        builtIn = true
                        return (address, port)
                    } catch {
                        let failure = (error as? Failure) ?? Failure(code: "vpn_failed", text: "\(LocalVPN.name) didn't start: \(error.localizedDescription)")
                        Session.keepVPNFailure(failure)
                        // B378: an install still goes through LocalDevVPN or Tailscale, but only when one is on: a
                        // connect to 10.7.0.1 with no tunnel fails as "device socket io failed", hiding this error
                        guard Session.otherRouteOn() else { throw failure }
                        ilog("\(LocalVPN.name) didn't start (\(failure.text)); trying LocalDevVPN or Tailscale")
                    }
                }
            }
            let tailnet = Tailscale.useForInstall()
            // B246: connecting again after a drop keeps the first connection's route. Automatic chose LocalDevVPN
            // while Tailscale's VPN was coming back (the 15 Pro), and that connect could only fail.
            if let want = pinnedTailscale, want != tailnet {
                throw Failure(code: "connect_failed", text: want ? "Tailscale isn't back on yet" : "Tailscale came on; this install started over LocalDevVPN")
            }
            guard tailnet else { return (address, port) }
            if second {
                // the install's session runs the node and the relay; starting or stopping them here would cut it off
                let local = Tailscale.mapPort(port)
                guard local != port else { throw Failure(code: "connect_failed", text: "Tailscale: the install's relay isn't running") }
                viaTailscale = true
                return ("127.0.0.1", local)
            }
            watch.begin("starting Tailscale", Limit.tunnel)
            let local = try Tailscale.beginInstall(port: port)
            viaTailscale = true
            return ("127.0.0.1", local)
        }

        // B378: the built-in VPN's last start failure, said again while LocalVPN.failedNow skips a new start
        private static let failureLock = NSLock()
        private static var vpnFailure: Failure? // guarded by failureLock
        static func keepVPNFailure(_ f: Failure) { failureLock.lock(); vpnFailure = f; failureLock.unlock() }
        static func lastVPNFailure() -> Failure {
            failureLock.lock(); defer { failureLock.unlock() }
            return vpnFailure ?? Failure(code: "vpn_failed", text: "\(LocalVPN.name) didn't start a moment ago")
        }
        /// B378: with the built-in VPN down, is another way in on: Tailscale for installs, or LocalDevVPN answering
        /// at 10.7.0.1 (VPNCheck). Blocking (VPNCheck's probes: under a second).
        static func otherRouteOn() -> Bool {
            Tailscale.useForInstall() || (VPNCheck.status()["localDevVPN"] as? Bool ?? false)
        }

        init(watch: Watch, tailscale pinned: Bool? = nil, second: Bool = false) throws {
            self.watch = watch
            self.pinnedTailscale = pinned
            self.second = second
            guard let (kind, data) = IDevice.pairing() else {
                throw Failure(code: "not_paired", text: "pair this iPhone first (Settings > Installation)")
            }
            self.kind = kind
            switch kind {
            case .remotePairing:
                ilog("addresses: \(interfaceAddresses())")
                let first = try endpoint(remotePairingPort)
                let host = first.0
                var port = first.1
                // B220: the port it listens on now, by a probe over the same route (Tailscale's node is up by now)
                watch.begin("finding RemotePairing's port through \(via)", Limit.tunnel)
                let tailnet = viaTailscale
                let w = watch
                let rpPort = try IDevice.findRemotePairingPort(via: via) { p in
                    w.alive("probing port \(p)") // each probe gets the step's whole limit
                    return tailnet ? Tailscale.probe(p) : VPNCheck.probe(p)
                }
                if rpPort != remotePairingPort {
                    if tailnet {
                        let local = Tailscale.mapPort(rpPort)
                        guard local != rpPort else { throw Failure(code: "connect_failed", text: "Tailscale: couldn't open the local relay") }
                        port = local
                    } else { port = rpPort }
                }
                watch.begin("connecting to iOS at \(host):\(port) through \(via) (RemotePairing tunnel, RSD)", Limit.tunnel)
                var rp: OpaquePointer?
                try data.withUnsafeBytes { try check(rp_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &rp), "bad_pairing") }
                defer { rp_pairing_file_free(rp) }
                var a = sockaddr4(port, host: host)
                let t0 = Date()
                let err = withUnsafePointer(to: &a) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        tunnel_create_rppairing($0, socklen_t(MemoryLayout<sockaddr_in>.size), Brand.name, rp, nil, nil, &adapter, &handshake)
                    }
                }
                do { try check(err, "connect_failed") } catch let e as Failure { throw IDevice.connectFailure(e) }
                guard adapter != nil, handshake != nil else { throw Failure(code: "connect_failed", text: "idevice made no tunnel") }
                watch.setCloser(adapter_clone(adapter))
                ilog("tunnel and RSD up in \(String(format: "%.2f", Date().timeIntervalSince(t0))) s: \(rsdSummary())")
                // A pair-verify that fell back to pair-setup updates the file in place: keep what it is now.
                if let now = try? IDevice.bytes(rp), now != data { try? savePairing(now, kind: .remotePairing) }
            case .lockdown:
                let (host, port) = try endpoint(lockdownPort)
                watch.begin("connecting to iOS at \(host):\(port) through \(via) (lockdown)", Limit.tunnel)
                var pf: OpaquePointer?
                try data.withUnsafeBytes { try check(idevice_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &pf), "bad_pairing") }
                var a = sockaddr4(port, host: host)
                let err = withUnsafePointer(to: &a) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { idevice_tcp_provider_new($0, pf, Brand.name, &provider) }
                }
                if err != nil { idevice_pairing_file_free(pf) } // consumed only on success
                try check(err, "connect_failed")
                try check(heartbeat_connect(provider, &heartbeat), "connect_failed")
                ilog("lockdown connected, heartbeat on")
                startHeartbeat()
            }
            // F372: connected: Cellular Data back on (an open connection keeps going, R72)
            if dataOff { LocalVPN.connected(dataOff: true); dataOff = false }
        }

        /// "RSD <uuid>, 63 services; AFC on 52012, installation_proxy on 52040", for the log.
        private func rsdSummary() -> String {
            var parts: [String] = []
            var uuid: UnsafeMutablePointer<CChar>?
            if rsd_get_uuid(handshake, &uuid).map({ idevice_error_free($0) }) == nil, let u = uuid {
                parts.append("RSD \(String(cString: u))"); rsd_free_string(u)
            }
            var all: UnsafeMutablePointer<CRsdServiceArray>?
            if rsd_get_services(handshake, &all).map({ idevice_error_free($0) }) == nil, let s = all {
                parts.append("\(s.pointee.count) services"); rsd_free_services(s)
            }
            for (label, name) in [("AFC", "com.apple.afc.shim.remote"), ("installation_proxy", "com.apple.mobile.installation_proxy.shim.remote")] {
                var info: UnsafeMutablePointer<CRsdService>?
                if let e = rsd_get_service_info(handshake, name, &info) { idevice_error_free(e); parts.append("\(label) MISSING") }
                else if let i = info { parts.append("\(label) on \(i.pointee.port)"); rsd_free_service(i) }
            }
            return parts.joined(separator: ", ")
        }

        /// lockdown drops a client that stops answering its heartbeat: answer marco with polo while connected.
        private func startHeartbeat() {
            beating = true
            Thread.detachNewThread { [weak self] in
                var interval: UInt64 = 15
                while let s = self, s.beating, let hb = s.heartbeat {
                    var next: UInt64 = 0
                    if heartbeat_get_marco(hb, interval, &next) != nil || heartbeat_send_polo(hb) != nil { break }
                    if next > 0 { interval = next }
                }
            }
        }

        func afc() throws -> OpaquePointer? {
            watch.begin("connecting to AFC", Limit.service)
            var c: OpaquePointer?
            switch kind {
            case .remotePairing: try check(afc_client_connect_rsd(adapter, handshake, &c), "afc_failed")
            case .lockdown: try check(afc_client_connect(provider, &c), "afc_failed")
            }
            ilog("AFC connected")
            return c
        }

        /// This phone's UDID from lockdown (GetValue UniqueDeviceID): for registering it in the developer account
        /// (native/Sources/ASC.swift), when the app's own profile lists several devices.
        func udid() throws -> String {
            watch.begin("asking lockdown for the UDID", Limit.service)
            var c: OpaquePointer?
            switch kind {
            case .remotePairing: try check(lockdownd_connect_rsd(adapter, handshake, &c), "udid_failed")
            case .lockdown: try check(lockdownd_connect(provider, &c), "udid_failed")
            }
            defer { lockdownd_client_free(c) }
            var value: plist_t?
            try check(lockdownd_get_value(c, "UniqueDeviceID", nil, &value), "udid_failed")
            defer { plist_free(value) }
            var s: UnsafeMutablePointer<CChar>?
            plist_get_string_val(value, &s)
            guard let p = s else { throw Failure(code: "udid_failed", text: "lockdown gave no UniqueDeviceID") }
            defer { plist_mem_free(p) }
            return String(cString: p)
        }

        func installationProxy() throws -> OpaquePointer? {
            watch.begin("connecting to installation_proxy", Limit.service)
            var c: OpaquePointer?
            switch kind {
            case .remotePairing: try check(installation_proxy_connect_rsd(adapter, handshake, &c), "install_failed")
            case .lockdown: try check(installation_proxy_connect(provider, &c), "install_failed")
            }
            ilog("installation_proxy connected")
            return c
        }

        deinit {
            beating = false
            watch.releaseCloser()
            if let h = heartbeat { heartbeat_client_free(h) }
            if let h = handshake { rsd_handshake_free(h) }
            if let a = adapter { adapter_free(a) }
            if let p = provider { idevice_provider_free(p) }
            if viaTailscale && !second { Tailscale.endInstall() }
            if builtIn { LocalVPN.connected(dataOff: dataOff); LocalVPN.end() } // F372: data back on if a connect failed
        }
    }

    /// Connects once with the stored pairing: "is the pairing still good and LocalDevVPN on". Blocking.
    static func verify() throws -> Kind { try verify(tailscale: nil) }

    /// B274: `tailscale` pins the route (Tailscale's Test Connection checks the pairing through Tailscale only).
    static func verify(tailscale pinned: Bool?) throws -> Kind {
        try watched("verify") { w in
            let s = try Session(watch: w, tailscale: pinned)
            if let u = try? s.udid() { PhoneID.remember(u) } // a check is a free chance to learn it
            return s.kind
        }
    }

    /// This phone's UDID through the pairing (blocking). PhoneID keeps it.
    static func readUDID() throws -> String {
        let u = try watched("udid") { try Session(watch: $0).udid() }
        PhoneID.remember(u)
        return u
    }

    /// B138: the application-identifier iOS has for the installed app `bundleID` (installation_proxy Browse, its
    /// Entitlements), or nil when iOS lists no such user app or no entitlements. Blocking; call it on `queue`.
    static func installedAppID(_ bundleID: String) throws -> String? {
        try watched("appid") { (w: Watch) -> String? in
            let s = try Session(watch: w)
            let ip = try s.installationProxy()
            defer { installation_proxy_client_free(ip) }
            w.begin("asking installation_proxy for \(bundleID)", Limit.service)
            let opts = plist_new_dict()
            defer { plist_free(opts) } // browse copies it
            plist_dict_set_item(opts, "ApplicationType", plist_new_string("User"))
            let ids = plist_new_array()
            plist_array_append_item(ids, plist_new_string(bundleID))
            plist_dict_set_item(opts, "BundleIDs", ids)
            let attrs = plist_new_array()
            plist_array_append_item(attrs, plist_new_string("CFBundleIdentifier"))
            plist_array_append_item(attrs, plist_new_string("Entitlements"))
            plist_dict_set_item(opts, "ReturnAttributes", attrs)
            var list: UnsafeMutablePointer<plist_t?>?
            var n = 0
            try check(installation_proxy_browse(ip, opts, &list, &n), "appid_failed")
            defer { if let l = list { idevice_plist_array_free(l, UInt(n)) } }
            func string(_ dict: plist_t?, _ key: String) -> String? {
                guard let d = dict, plist_get_node_type(d) == PLIST_DICT, let v = plist_dict_get_item(d, key),
                      plist_get_node_type(v) == PLIST_STRING else { return nil }
                var p: UnsafeMutablePointer<CChar>?
                plist_get_string_val(v, &p)
                guard let c = p else { return nil }
                defer { plist_mem_free(c) }
                return String(cString: c)
            }
            guard let l = list else { return nil }
            for i in 0..<n where string(l[i], "CFBundleIdentifier") == bundleID {
                guard let app = l[i], let ents = plist_dict_get_item(app, "Entitlements") else { return nil }
                let id = string(ents, "application-identifier")
                ilog("installed \(bundleID): application-identifier \(id ?? "none")")
                return id
            }
            return nil
        }
    }

    // ---- Installing

    enum Step { case connected, upload(Double), install(Double) }

    private final class ProgressBox { let f: (UInt64) -> Void; init(_ f: @escaping (UInt64) -> Void) { self.f = f } }

    /// Installs a signed IPA on this phone (blocking; call it on `queue`). Every step has a time limit (Limit), so
    /// it ends with an error rather than waiting for ever. Installing this app itself works too: installd ends the
    /// process, so the call never returns then. `note` gets a line per step for the progress page's console.
    ///
    /// B246: `bundleID` and `version` (the signed app's) let a dropped connection end well. A drop (the app left the
    /// front, the tunnel or Tailscale reset) connects again, up to HereRecheck.reconnects times: during the copy it
    /// carries on from the end of iOS's file; once the install was sent, it asks iOS for the app and reports it
    /// installed when iOS lists the new copy. Only installd's own error (or a drop that never reconnects) fails.
    static func install(_ ipa: URL, bundleID: String? = nil, version: String? = nil,
                        note: @escaping (String) -> Void = { _ in }, progress: @escaping (Step) -> Void) throws {
        let size = (try? ipa.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0
        ilog("installing \(ipa.lastPathComponent) (\(mb(size)))\(bundleID.map { " as \($0) \(version ?? "?")" } ?? "")")
        let run = HereRun(ipa: ipa, size: size, remote: "\(stagingDir)/\(UUID().uuidString).ipa", bundleID: bundleID, version: version)
        var attempt = 0
        var firstDrop: Failure?
        while true {
            do {
                try watched(attempt == 0 ? "install" : "install, connection \(attempt + 1)") { (w: Watch) -> Void in
                    try installTry(run, watch: w, note: note, progress: progress)
                }
                return
            } catch where run.lookedInstalled {
                // B251: a second look found the new copy while the install's own connection was quiet
                ilog("installed (seen on a second connection); the first one ended with: \(error.localizedDescription)")
                note("iOS lists \(run.bundleID ?? "the app") \(run.version ?? ""): installed")
                progress(.install(1))
                return
            } catch let f as Failure where !run.connected && isEarlyEOF(f) && IDevice.pairing()?.kind == .remotePairing {
                // B274: Pair Again, not the socket error (the row and its log say what to do)
                let via = LocalVPN.available ? LocalVPN.name : Tailscale.useForInstall() ? "Tailscale" : "LocalDevVPN"
                ilog("first connect reset during pair-verify through \(via): \(f.text); the pairing is stale")
                throw pairAgain(f, via: via)
            } catch let f as Failure where run.connected && HereRecheck.shouldReconnect(code: f.code, lib: f.lib, reconnecting: firstDrop != nil) {
                attempt += 1
                if firstDrop == nil { firstDrop = f }
                let stage = run.installSent ? "while iOS was installing it" : run.copied ? "after the copy" : "during the copy (\(mb(run.sent)) of \(mb(size)))"
                guard attempt <= HereRecheck.reconnects else {
                    ilog("gave up \(stage) after \(HereRecheck.reconnects) tries: \(f.errorDescription ?? f.text)")
                    let first = firstDrop ?? f
                    // installd goes on without us: the app may be on the Home Screen anyway
                    let maybe = run.installSent ? ". iOS may still have installed it: look on the Home Screen" : ""
                    throw Failure(code: first.code, text: "lost the connection to iOS \(stage) and couldn't get it back (\(first.text))\(maybe)", lib: first.lib)
                }
                ilog("dropped \(stage): \(f.errorDescription ?? f.text) (try \(attempt) of \(HereRecheck.reconnects))")
                note("Lost the connection to iOS \(stage): \(f.text). Connecting again (\(attempt) of \(HereRecheck.reconnects))")
                Thread.sleep(forTimeInterval: HereRecheck.pause(attempt))
            }
        }
    }

    /// One connection's worth of install(): connect, ask what iOS has (once), copy what iOS lacks, then install, or
    /// after a drop, ask iOS whether the install it was sent landed.
    private static func installTry(_ run: HereRun, watch w: Watch, note: @escaping (String) -> Void,
                                   progress: @escaping (Step) -> Void) throws {
        let s = try Session(watch: w, tailscale: run.tailnet)
        let route = s.kind == .remotePairing ? "\(s.via) (RemotePairing tunnel)" : "\(s.via) (lockdown)"
        if run.tailnet == nil { run.tailnet = s.tailnet }
        if !run.connected {
            note("Connected to iOS through \(route)")
            progress(.connected)
            run.connected = true
        } else {
            note("Connected to iOS again through \(route)")
        }
        if run.before == nil, let bid = run.bundleID {
            do {
                let ip = try s.installationProxy()
                defer { installation_proxy_client_free(ip) }
                let st = try appState(ip, bid, watch: w)
                run.before = st.map { .present($0) } ?? .absent
                ilog("before the install, iOS lists \(bid): \(st.map(describe) ?? "nothing")")
            } catch let f as Failure where f.dropped {
                throw f
            } catch {
                run.before = .unknown
                ilog("before the install, couldn't ask iOS for \(bid): \(error.localizedDescription)")
            }
        }
        if !run.copied {
            try upload(run, session: s, watch: w, note: note, progress: progress)
            run.copied = true
        }
        let ip = try s.installationProxy()
        defer { installation_proxy_client_free(ip) }
        if run.installSent {
            if try askInstalled(run, ip, watch: w, note: note) {
                removeStaged(run.remote, session: s, watch: w)
                progress(.install(1))
                return
            }
            removeStaged(run.remote, session: s, watch: w)
            throw Failure(code: "install_failed", text: "lost the connection to iOS while it was installing, and iOS doesn't list \(run.bundleID ?? "the app") \(run.version ?? "") after \(Int(HereRecheck.askFor)) s. It may still be installing it: look on the Home Screen")
        }
        w.begin("iOS installing the app (installd)", Limit.install)
        note("iOS is installing it")
        var lastPct: UInt64 = .max
        let box = Unmanaged.passRetained(ProgressBox { pct in
            w.alive("\(pct)% installed")
            if pct != lastPct { lastPct = pct; ilog("installd: \(pct)%") }
            progress(.install(Double(min(pct, 100)) / 100))
        })
        defer { box.release() }
        let cb: @convention(c) (UInt64, UnsafeMutableRawPointer?) -> Void = { pct, ctx in
            guard let ctx = ctx else { return }
            Unmanaged<ProgressBox>.fromOpaque(ctx).takeUnretainedValue().f(pct)
        }
        run.installSent = true
        lookWhileQuiet(run, watch: w)
        let err = installation_proxy_install_with_callback(ip, run.remote, nil, cb, box.toOpaque())
        do {
            try check(err, "install_failed")
        } catch let f as Failure where f.dropped && run.bundleID != nil && run.version != nil {
            throw f // install() connects again and asks iOS; the staged IPA stays for a second try
        } catch {
            removeStaged(run.remote, session: s, watch: w)
            throw error
        }
        ilog("installd: Complete")
        removeStaged(run.remote, session: s, watch: w)
        progress(.install(1))
    }

    /// After a drop once the install was sent: asks iOS for the app every HereRecheck.askEvery seconds, for up to
    /// HereRecheck.askFor (installd goes on without us). True when iOS lists the new copy (or the version asked for,
    /// when nothing tells it from what was there before); false when it still lists what it had, or nothing.
    private static func askInstalled(_ run: HereRun, _ ip: OpaquePointer?, watch w: Watch, note: (String) -> Void) throws -> Bool {
        guard let bid = run.bundleID, let version = run.version else {
            throw Failure(code: "install_failed", text: "lost the connection to iOS while it was installing, and can't ask it for the app")
        }
        note("Asking iOS whether it installed \(bid) \(version)")
        // one deadline for the whole install, however many times it connects again
        if run.askUntil == nil { run.askUntil = Date().addingTimeInterval(HereRecheck.askFor) }
        let until = run.askUntil!
        var said = ""
        var unsureSince: Date?
        while true {
            let now = try appState(ip, bid, watch: w)
            let v = HereRecheck.verdict(version: version, before: run.before ?? .unknown, now: now)
            ilog("iOS lists \(bid): \(now.map(describe) ?? "nothing") -> \(v)")
            if v != .cannotTell { unsureSince = nil }
            switch v {
            case .installed:
                note("iOS lists \(bid) \(version): installed")
                return true
            case .cannotTell where Date().timeIntervalSince(unsureSince ?? Date()) >= HereRecheck.settle:
                note("iOS lists \(bid) \(version); nothing tells it from the copy that was there, so it counts as installed")
                return true
            case .cannotTell, .notYet, .sameAsBefore:
                if v == .cannotTell, unsureSince == nil { unsureSince = Date() }
                if Date() >= until { return v == .cannotTell }
                let line = v == .notYet ? "not yet" : v == .sameAsBefore ? "still the earlier copy" : "this version, nothing to tell it from the earlier copy"
                if line != said { said = line; note("iOS doesn't list the new copy yet (\(line)); asking again") }
                w.begin("waiting for iOS to list \(bid) \(version)", HereRecheck.askEvery + Limit.service)
                Thread.sleep(forTimeInterval: HereRecheck.askEvery)
            }
        }
    }

    /// B251: the looks' state for one installd step, shared by the watchdog's ticks and the look's own thread.
    private final class Looker {
        let lock = NSLock()
        var state = HereRecheck.SecondLook()
        var busy = false
    }

    /// B251: while installd's step is quiet, a second connection asks iOS for the app (HereRecheck.SecondLook); when
    /// iOS lists the new copy, the step ends and install() reports it installed. Each look runs on its own thread
    /// under its own Watch, so the watchdog's tick never waits on it. Nothing to ask without the bundle ID and version.
    private static func lookWhileQuiet(_ run: HereRun, watch w: Watch) {
        guard let bid = run.bundleID, let version = run.version else { return }
        let looker = Looker()
        var step = 0
        step = w.whileQuiet { quiet in
            looker.lock.lock()
            guard !looker.busy, looker.state.due(quiet: quiet) else { looker.lock.unlock(); return }
            looker.busy = true
            looker.lock.unlock()
            ilog("installd quiet for \(Int(quiet)) s: asking iOS for \(bid) \(version) on a second connection")
            let th = Thread {
                let v = secondLook(run, bid: bid, version: version)
                looker.lock.lock(); looker.busy = false; looker.lock.unlock()
                guard HereRecheck.SecondLook.ends(v) else { return }
                let stopped = w.stop("iOS lists \(bid) \(version) (asked on a second connection)", step: step) {
                    run.lookedInstalled = true
                }
                ilog(stopped ? "second look: installed; ending the wait for installd" : "second look: installed, but the step had already ended")
            }
            th.stackSize = 4 << 20 // as watched's own threads
            th.qualityOfService = .userInitiated
            th.start()
        }
    }

    /// B251: one second look: a session of its own beside the install's (sharing its route), installation_proxy
    /// Browse for the app, and the verdict; nil when iOS couldn't be asked (the route is down, or a second
    /// connection wasn't let in). A look that sees the new copy installed removes the staged IPA, as the install
    /// would have.
    private static func secondLook(_ run: HereRun, bid: String, version: String) -> HereRecheck.Verdict? {
        do {
            return try watched("second look") { (w: Watch) -> HereRecheck.Verdict in
                let s = try Session(watch: w, tailscale: run.tailnet, second: true)
                let ip = try s.installationProxy()
                defer { installation_proxy_client_free(ip) }
                let now = try appState(ip, bid, watch: w)
                let v = HereRecheck.verdict(version: version, before: run.before ?? .unknown, now: now)
                ilog("second look: iOS lists \(bid): \(now.map(describe) ?? "nothing") -> \(v)")
                if v == .installed { removeStaged(run.remote, session: s, watch: w) }
                return v
            }
        } catch {
            ilog("second look: couldn't ask iOS (\(error.localizedDescription)); waiting on installd")
            return nil
        }
    }

    /// What iOS lists for the user app `bundleID` (installation_proxy Browse), or nil when it lists none.
    private static func appState(_ ip: OpaquePointer?, _ bundleID: String, watch w: Watch) throws -> HereRecheck.AppState? {
        w.begin("asking installation_proxy for \(bundleID)", Limit.service)
        let opts = plist_new_dict()
        defer { plist_free(opts) } // browse copies it
        plist_dict_set_item(opts, "ApplicationType", plist_new_string("User"))
        let ids = plist_new_array()
        plist_array_append_item(ids, plist_new_string(bundleID))
        plist_dict_set_item(opts, "BundleIDs", ids)
        let attrs = plist_new_array()
        for a in ["CFBundleIdentifier", "CFBundleVersion", "CFBundleShortVersionString", "Path"] {
            plist_array_append_item(attrs, plist_new_string(a))
        }
        plist_dict_set_item(opts, "ReturnAttributes", attrs)
        var list: UnsafeMutablePointer<plist_t?>?
        var n = 0
        try check(installation_proxy_browse(ip, opts, &list, &n), "install_failed")
        defer { if let l = list { idevice_plist_array_free(l, UInt(n)) } }
        func string(_ dict: plist_t?, _ key: String) -> String? {
            guard let d = dict, plist_get_node_type(d) == PLIST_DICT, let v = plist_dict_get_item(d, key),
                  plist_get_node_type(v) == PLIST_STRING else { return nil }
            var p: UnsafeMutablePointer<CChar>?
            plist_get_string_val(v, &p)
            guard let c = p else { return nil }
            defer { plist_mem_free(c) }
            return String(cString: c)
        }
        guard let l = list else { return nil }
        for i in 0..<n where string(l[i], "CFBundleIdentifier") == bundleID {
            return HereRecheck.AppState(path: string(l[i], "Path"), version: string(l[i], "CFBundleVersion"),
                                        shortVersion: string(l[i], "CFBundleShortVersionString"))
        }
        return nil
    }

    private static func describe(_ s: HereRecheck.AppState) -> String {
        // the bundle container's folder (…/Application/<UUID>/X.app): a new install gets a new one
        "\(s.shortVersion ?? "?") (\(s.version ?? "?")) in \(s.path.map { (($0 as NSString).deletingLastPathComponent as NSString).lastPathComponent } ?? "?")"
    }

    private static func removeStaged(_ remote: String, session s: Session, watch w: Watch) {
        guard let afc = try? s.afc() else { return }
        w.begin("removing the staged IPA", Limit.afcStep)
        afc_remove_path(afc, remote).map(idevice_error_free); afc_client_free(afc)
    }

    static let chunk = 1 << 20

    static func mb(_ n: Int) -> String { String(format: "%.1f MB", Double(n) / 1_048_576) }

    /// Copies the IPA to PublicStaging. B246: after a drop it carries on from the end of iOS's file (a whole chunk
    /// back, HereRecheck.resumeAt) instead of starting over, and the speed in front and in the background goes to the
    /// log, for telling a slow copy in the background from a slow route.
    private static func upload(_ run: HereRun, session s: Session, watch w: Watch,
                               note: (String) -> Void, progress: (Step) -> Void) throws {
        let total = run.size, remote = run.remote
        let fh = try FileHandle(forReadingFrom: run.ipa)
        defer { try? fh.close() }
        let afc = try s.afc()
        defer { afc_client_free(afc) }
        w.begin("opening \(remote) on iOS (AFC)", Limit.afcStep)
        afc_make_directory(afc, stagingDir).map(idevice_error_free) // there already: an error, and fine
        var from = 0
        if run.sent > 0 {
            var info = AfcFileInfo()
            if afc_get_file_info(afc, remote, &info).map({ idevice_error_free($0) }) == nil {
                from = HereRecheck.resumeAt(remoteSize: Int(info.size), sent: run.sent, chunk: chunk)
                afc_file_info_free(&info)
            }
        }
        var file: OpaquePointer?
        if from > 0 {
            try check(afc_file_open(afc, remote, AfcRw, &file), "upload_failed") // r+: keeps what iOS has
            var pos: Int64 = 0
            do { try check(afc_file_seek(file, Int64(from), 0 /* SEEK_SET */, &pos), "upload_failed") } catch {
                afc_file_close(file).map(idevice_error_free)
                throw error
            }
            try fh.seek(toOffset: UInt64(from))
            ilog("AFC: carrying on from \(mb(from)) of \(mb(total)) (iOS had \(mb(run.sent)) when the connection dropped)")
            note("Carrying on with the copy from \(mb(from)) of \(mb(total))")
        } else {
            try check(afc_file_open(afc, remote, AfcWrOnly, &file), "upload_failed")
            note("Copying the IPA to iOS (\(mb(total)))")
        }
        w.begin("copying the IPA to iOS (AFC)", Limit.upload)
        var sent = from, logged = from
        run.sent = from
        if run.copyStart == nil { run.copyStart = Date() }
        let t0 = Date()
        var last = Date()
        var quiet = HereRecheck.CopyQuiet(), shown = Limit.upload, suspensions = w.suspensions
        do {
            while let d = try fh.read(upToCount: chunk), !d.isEmpty {
                try d.withUnsafeBytes { try check(afc_file_write(file, $0.baseAddress?.assumingMemoryBound(to: UInt8.self), d.count), "upload_failed") }
                sent += d.count
                run.sent = sent
                let now = Date()
                // B293: the gap since the last chunk landed, a drop and its reconnect included: CopySpeed counts
                // its stalled part as waiting
                run.speed.add(d.count, now.timeIntervalSince(run.lastLanded ?? t0), front: AppFront.now)
                run.lastLanded = now
                // B292: notice a dead route sooner than 30 s when chunks have been landing fast
                // after a suspension the pace starts over: the watchdog may count it only after the chunk whose gap
                // spans it was added, so that gap goes too
                let s = w.suspensions
                if s != suspensions { quiet = HereRecheck.CopyQuiet() } else { quiet.add(now.timeIntervalSince(last)) }
                suspensions = s
                last = now
                let limit = quiet.limit
                w.setLimit(limit)
                if abs(limit - shown) >= 5 {
                    ilog("AFC: quiet limit \(Int(limit)) s (from how fast chunks land)")
                    shown = limit
                }
                w.alive("\(mb(sent)) of \(mb(total)) copied")
                if sent - logged >= 8 * chunk || sent == total {
                    logged = sent
                    let secs = max(now.timeIntervalSince(t0), 0.001)
                    ilog("AFC: \(mb(sent)) of \(mb(total)) (\(String(format: "%.1f", Double(sent - from) / 1_048_576 / secs)) MB/s, \(AppFront.now ? "in front" : "in the background"))")
                }
                progress(.upload(total > 0 ? Double(sent) / Double(total) : 0))
            }
        } catch {
            afc_file_close(file).map(idevice_error_free)
            throw error
        }
        w.begin("closing \(remote) on iOS (AFC)", Limit.afcStep)
        try check(afc_file_close(file), "upload_failed")
        let secs = Date().timeIntervalSince(run.copyStart ?? t0)
        ilog("AFC: copied \(mb(sent)) in \(String(format: "%.1f", secs)) s: \(run.speed.summary)")
        note("Copied \(mb(sent)) to iOS")
    }
}
