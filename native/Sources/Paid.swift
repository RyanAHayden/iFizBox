// F57: the shell's half of paid packages (F20's web/app/screens/extras.js and core/payment.js; Sileo's Payment
// Provider API, https://developer.getsileo.app/payment-providers). Vendors send no CORS headers and the spec wants
// the payment secret in the Keychain, so these go through Swift:
//
//   net.request {method, url, headers, body}   -> {status, headers, body}  https only, GET, POST or PUT; body in is a
//                                                 string (the JSON the page built) or null, body out is base64 like
//                                                 net.fetch's
//   device.info                                -> {udid, model}  MobileGestalt's UniqueDeviceID and hw.machine
//                                                 (iPhone14,2), what Sileo sends as udid and model/device; when
//                                                 MobileGestalt refuses (the sideload build), PhoneID's UDID
//                                                 (pairing, or the embedded profile's single device)
//   keychain.get {key} -> string | null, keychain.set {key, value}, keychain.remove {key}
//                                                 generic passwords behind the passcode / Face ID (.userPresence,
//                                                 WhenPasscodeSetThisDeviceOnly); without a passcode on the phone,
//                                                 WhenUnlockedThisDeviceOnly (see the F57 journal)
//   auth.session {url, callbackScheme}         -> the callback URL, or null when the user closed the sheet
//                                                 (ASWebAuthenticationSession; "sileo" needs no registered scheme)
//   paid.install {url, package, version[, stream]} -> {code, stdout, stderr}  jailbreak build only: downloads the
//                                                 one-time https URL from authorize_download straight away into
//                                                 Paid.dir (= HELPER_PAID_DIR) as <UUID>.deb and runs
//                                                 `ifizbox-helper install-paid <path> <package> <version>` (copies it,
//                                                 checks its control is that package and version, apt-get install),
//                                                 then removes the download
//   paid.download / paid.cached                   F308, both builds: a paid tweak's .deb kept in the app's own storage
//                                                 (PaidTweaks, at the end of this file)
// Errors are "<code>: <message>" as in Apt.swift: bad_url, network, timeout, too_large, not_found, keychain,
// device, sideload, helper.
// SPDX-License-Identifier: GPL-3.0-or-later
import AuthenticationServices
import Foundation
import LocalAuthentication
import Security
import UIKit

enum Paid {
    static let dir = "/var/mobile/Library/Caches/com.ryha.ifizbox/paid" // = native/helper/policy.h HELPER_PAID_DIR
    static let service = "com.ryha.ifizbox.payment"

    static func register(_ b: Bridge) {
        b.on("net.request") { c in request(c) }
        b.on("device.info") { c in
            Apt.work(c) { () throws -> Any? in
                guard let udid = deviceUDID() else {
                    throw BridgeError("device", AppMode.current == .jailbreak
                        ? "can't read this iPhone's UDID (MobileGestalt refused UniqueDeviceID)"
                        : "this iPhone's UDID isn't known: pair this iPhone (Settings > Installation & Signing > This iPhone > Pairing) and try again")
                }
                return ["udid": udid, "model": machine()]
            }
        }
        b.on("keychain.get") { c in
            Apt.work(c) { () throws -> Any? in try Keychain.get(try key(c), prompt: "Use your payment details") }
        }
        b.on("keychain.set") { c in
            Apt.work(c) { () throws -> Any? in
                let k = try key(c)
                guard let v = c.params["value"] as? String else { try Keychain.remove(k); return true }
                try Keychain.set(k, v)
                return true
            }
        }
        b.on("keychain.remove") { c in Apt.work(c) { () throws -> Any? in try Keychain.remove(try key(c)); return true } }
        b.on("auth.session") { c in AuthSession.start(c) }
        b.on("paid.install") { c in install(c) }
        b.on("paid.download") { c in PaidTweaks.download(c) } // F308
        b.on("paid.cached") { c in PaidTweaks.cached(c) } // F308
    }

    static func key(_ c: Bridge.Call) throws -> String {
        guard let k = c.params["key"] as? String, !k.isEmpty, k.utf8.count <= 512 else {
            throw BridgeError("keychain", "no key")
        }
        return k
    }

    // ---- net.request

    static func request(_ c: Bridge.Call) {
        guard let url = Apt.httpURL(c.params["url"]), url.scheme?.lowercased() == "https" else {
            return Apt.reply(c, nil, "bad_url: not an https URL")
        }
        let method = ((c.params["method"] as? String) ?? "GET").uppercased()
        // PUT: the Free Apple ID sign-in's SMS code request (web/app/screens/free-apple-id.js nativeTransport)
        guard ["GET", "POST", "PUT"].contains(method) else { return Apt.reply(c, nil, "bad_url: method \(method)") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        for (k, v) in (c.params["headers"] as? [String: Any]) ?? [:] {
            guard let v = v as? String else { continue }
            // URLSession sets these itself; a page-picked Host or length could only confuse it.
            if ["host", "content-length", "connection", "transfer-encoding"].contains(k.lowercased()) { continue }
            req.setValue(v, forHTTPHeaderField: k)
        }
        if method != "GET", let body = c.params["body"] as? String { req.httpBody = Data(body.utf8) }
        // GrandSlam answers a reused connection with 5xx: a session of its own, so a connection of its own.
        let own = url.host?.lowercased() == "gsa.apple.com" ? URLSession(configuration: Apt.session.configuration) : nil
        defer { own?.finishTasksAndInvalidate() } // lets the task below finish first
        (own ?? Apt.session).dataTask(with: req) { data, resp, err in
            if let e = err as? URLError {
                return Apt.reply(c, nil, "\(e.code == .timedOut ? "timeout" : "network"): \(e.localizedDescription)")
            }
            if let e = err { return Apt.reply(c, nil, "network: \(e.localizedDescription)") }
            guard let http = resp as? HTTPURLResponse else { return Apt.reply(c, nil, "network: no HTTP answer") }
            let body = data ?? Data()
            if body.count > Apt.maxBody { return Apt.reply(c, nil, "too_large: more than \(Apt.maxBody >> 20) MB") }
            var headers: [String: String] = [:]
            for (k, v) in http.allHeaderFields { headers["\(k)".lowercased()] = "\(v)" }
            Apt.reply(c, ["status": http.statusCode, "headers": headers, "body": body.base64EncodedString()], nil)
        }.resume()
    }

    // ---- device.info

    // MobileGestalt's UniqueDeviceID, as Sileo reads it (needs com.apple.private.MobileGestalt.AllowedProtectedKeys
    // in entitlements.plist on iOS 15+).
    static func udid() -> String? {
        typealias MGCopyAnswer = @convention(c) (CFString) -> Unmanaged<CFTypeRef>?
        guard let lib = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_NOW), let sym = dlsym(lib, "MGCopyAnswer") else {
            return nil
        }
        let f = unsafeBitCast(sym, to: MGCopyAnswer.self)
        guard let v = f("UniqueDeviceID" as CFString)?.takeRetainedValue() as? String, !v.isEmpty else { return nil }
        return v
    }

    // B183: device.info's UDID. MobileGestalt first; the sideload build can't read it (no private entitlement), so
    // then PhoneID's: the UDID lockdown gave through pairing, or the embedded profile's one device. A profile listing
    // several devices names no single UDID: nil, and device.info says to pair.
    static func deviceUDID() -> String? {
        if let u = udid() { return u }
        return PhoneID.udid
    }

    static func machine() -> String {
        var u = utsname()
        uname(&u)
        return withUnsafeBytes(of: &u.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }

    // ---- paid.install

    static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 30 * 60
        cfg.httpAdditionalHeaders = Apt.session.configuration.httpAdditionalHeaders
        return URLSession(configuration: cfg)
    }()

    static func install(_ c: Bridge.Call) {
        guard AppMode.current == .jailbreak else {
            return Apt.reply(c, nil, "sideload: paid packages install with the jailbreak build")
        }
        guard let url = Apt.httpURL(c.params["url"]), url.scheme?.lowercased() == "https" else {
            return Apt.reply(c, nil, "bad_url: not an https URL")
        }
        guard let pkg = c.params["package"] as? String, !pkg.isEmpty,
              let version = c.params["version"] as? String, !version.isEmpty else {
            return Apt.reply(c, nil, "helper: no package or version")
        }
        let stream = (c.params["stream"] as? Bool) ?? false
        let emit: (([[String: Any]]) -> Void)? = stream ? { c.emitOnMain($0) } : nil
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
        } catch { return Apt.reply(c, nil, "helper: can't make \(dir): \(error.localizedDescription)") }
        emit?([["fd": "status", "line": "dlstatus:\(pkg):0:Downloading"]])
        // The URL is one-time and expires in a minute or two: fetch it now, once.
        session.downloadTask(with: url) { tmp, resp, err in
            if let e = err as? URLError {
                return Apt.reply(c, nil, "\(e.code == .timedOut ? "timeout" : "network"): \(e.localizedDescription)")
            }
            if let e = err { return Apt.reply(c, nil, "network: \(e.localizedDescription)") }
            guard let tmp = tmp, let http = resp as? HTTPURLResponse else { return Apt.reply(c, nil, "network: no HTTP answer") }
            if http.statusCode >= 400 { return Apt.reply(c, nil, "not_found: HTTP \(http.statusCode) for the download") }
            let head = (try? FileHandle(forReadingFrom: tmp)).map { h -> Data in defer { try? h.close() }; return h.readData(ofLength: 8) }
            guard head == Data("!<arch>\n".utf8) else { return Apt.reply(c, nil, "not_found: the vendor's download is not a .deb") }
            let path = dir + "/" + UUID().uuidString + ".deb"
            do { try FileManager.default.moveItem(atPath: tmp.path, toPath: path) }
            catch { return Apt.reply(c, nil, "helper: can't keep the download: \(error.localizedDescription)") }
            DispatchQueue.global(qos: .userInitiated).async {
                defer { try? FileManager.default.removeItem(atPath: path) }
                do { Apt.reply(c, try Helper.run(["install-paid", path, pkg, version], emit: emit), nil) }
                catch let e as BridgeError { Apt.reply(c, nil, e.text) }
                catch { Apt.reply(c, nil, "helper: \(error.localizedDescription)") }
            }
        }.resume()
    }
}

// The payment secrets: generic passwords under Paid.service, one per key (core/payment.js's
// "ifizbox.payment:<vendor>"). Reading one asks for the passcode or Face ID.
enum Keychain {
    static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Paid.service,
         kSecAttrAccount as String: key]
    }

    static func get(_ key: String, prompt: String) throws -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        let ctx = LAContext()
        ctx.localizedReason = prompt
        q[kSecUseAuthenticationContext as String] = ctx
        var out: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        switch st {
        case errSecSuccess:
            guard let item = out as? [String: Any], let d = item[kSecValueData as String] as? Data else { return nil }
            let value = String(decoding: d, as: UTF8.self)
            // OwnKeychain: one written before into a group other apps share moves to ours, now that it's been read
            if let g = OwnKeychain.group, let old = item[kSecAttrAccessGroup as String] as? String, old != g {
                moveIn(key, value, from: old)
            }
            return value
        case errSecItemNotFound: return nil
        case errSecUserCanceled, errSecAuthFailed: throw BridgeError("keychain", "cancelled: the passcode or Face ID check didn't pass")
        default: throw BridgeError("keychain", "the Keychain refused (\(st))")
        }
    }

    static func set(_ key: String, _ value: String) throws {
        try remove(key)
        let st = add(key, value)
        guard st == errSecSuccess else { throw BridgeError("keychain", "the Keychain refused the secret (\(st))") }
    }

    // OwnKeychain: a secret read from another group goes into ours first; the old copy goes only once that worked.
    static func moveIn(_ key: String, _ value: String, from old: String) {
        let st = add(key, value)
        guard st == errSecSuccess || st == errSecDuplicateItem else { return }
        var q = query(key)
        q[kSecAttrAccessGroup as String] = old
        SecItemDelete(q as CFDictionary)
    }

    static func add(_ key: String, _ value: String) -> OSStatus {
        var add = OwnKeychain.scoped(query(key))
        add[kSecValueData as String] = Data(value.utf8)
        // Behind the passcode / Face ID when the phone has a passcode. Without one, .userPresence items can't be
        // added at all: keep it to this device, unlocked only, so buying still works.
        var cfErr: Unmanaged<CFError>?
        if LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil),
           let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &cfErr) {
            add[kSecAttrAccessControl as String] = ac
        } else {
            add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        }
        return SecItemAdd(add as CFDictionary, nil)
    }

    static func remove(_ key: String) throws {
        let st = SecItemDelete(query(key) as CFDictionary)
        guard st == errSecSuccess || st == errSecItemNotFound else {
            throw BridgeError("keychain", "the Keychain refused to remove it (\(st))")
        }
    }
}

// auth.session: the vendor's sign-in or payment page in ASWebAuthenticationSession, which ends at the vendor's
// sileo://authentication_success?… or sileo://payment_completed. One sheet at a time.
final class AuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    static var current: AuthSession?
    let session: ASWebAuthenticationSession
    weak var window: UIWindow?

    init(_ session: ASWebAuthenticationSession, _ window: UIWindow?) {
        self.session = session
        self.window = window
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        window ?? ASPresentationAnchor()
    }

    static func start(_ c: Bridge.Call) {
        guard let url = Apt.httpURL(c.params["url"]), url.scheme?.lowercased() == "https" else {
            return Apt.reply(c, nil, "bad_url: not an https URL")
        }
        let scheme = (c.params["callbackScheme"] as? String) ?? "sileo"
        guard scheme.range(of: "^[a-z][a-z0-9+.-]*$", options: .regularExpression) != nil,
              !["http", "https", "file", AppScheme.scheme].contains(scheme) else {
            return Apt.reply(c, nil, "bad_url: bad callback scheme")
        }
        DispatchQueue.main.async {
            guard current == nil else { return c.reply(nil, "network: a sign-in sheet is already open") }
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { cb, err in
                DispatchQueue.main.async {
                    current = nil
                    if let cb = cb { return c.reply(cb.absoluteString, nil) }
                    if let e = err as? ASWebAuthenticationSessionError, e.code == .canceledLogin { return c.reply(nil, nil) }
                    c.reply(nil, "network: \(err?.localizedDescription ?? "the sign-in sheet failed")")
                }
            }
            let holder = AuthSession(s, c.web?.window)
            s.presentationContextProvider = holder
            s.prefersEphemeralWebBrowserSession = false // keep Safari's vendor login, as Sileo does
            current = holder
            if !s.start() {
                current = nil
                c.reply(nil, "network: couldn't open the sign-in sheet")
            }
        }
    }
}

// F308: a paid tweak's .deb for the sideload build's Inject Tweaks (web/app/screens/tweaks.js paidTweaks). The page
// gets the one-time URL from authorize_download (core/payment.js paidTweakDeb); the shell downloads it once and keeps
// it in the app's own Application Support, one file per package and version, so re-signing and updates need no
// second purchase round trip. No extra encryption: the app's container is private to it, and the dylib ends up
// unencrypted inside the signed app anyway.
//
//   paid.download {url, package, version} -> {body}  base64 of the .deb (checked to start "!<arch>\n", 64 MB at
//                                                     most); older versions of that package are removed
//   paid.cached {package, version}        -> {body} | null
enum PaidTweaks {
    static let maxSize = 64 << 20 // = core/tweaks.js TWEAK_LIMIT
    static let dir: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("PaidTweaks", isDirectory: true)

    // <package>_<version>.deb; the version's ':' (an epoch) is written as '%3A'. Anything that isn't a Debian
    // package name or version is refused, so a name can't step out of the folder.
    static func file(_ c: Bridge.Call) throws -> (URL, String) {
        guard let pkg = c.params["package"] as? String, pkg.utf8.count <= 200,
              pkg.range(of: "^[A-Za-z0-9][A-Za-z0-9+.-]*$", options: .regularExpression) != nil else {
            throw BridgeError("bad_url", "not a package name")
        }
        guard let version = c.params["version"] as? String, version.utf8.count <= 200,
              version.range(of: "^[A-Za-z0-9][A-Za-z0-9.+~:_-]*$", options: .regularExpression) != nil else {
            throw BridgeError("bad_url", "not a package version")
        }
        let name = "\(pkg)_\(version.replacingOccurrences(of: ":", with: "%3A")).deb"
        return (dir.appendingPathComponent(name), pkg)
    }

    static func cached(_ c: Bridge.Call) {
        Apt.work(c) { () throws -> Any? in
            let (url, _) = try file(c)
            guard let data = try? Data(contentsOf: url), data.starts(with: Array("!<arch>\n".utf8)) else { return nil }
            return ["body": data.base64EncodedString()]
        }
    }

    static func download(_ c: Bridge.Call) {
        guard let src = Apt.httpURL(c.params["url"]), src.scheme?.lowercased() == "https" else {
            return Apt.reply(c, nil, "bad_url: not an https URL")
        }
        let target: URL, pkg: String
        do { let f = try file(c); target = f.0; pkg = f.1 } catch {
            return Apt.reply(c, nil, (error as? BridgeError)?.text ?? "bad_url: \(error.localizedDescription)")
        }
        // The URL is one-time and expires in a minute or two: fetch it now, once.
        Paid.session.downloadTask(with: src) { tmp, resp, err in
            if let e = err as? URLError {
                return Apt.reply(c, nil, "\(e.code == .timedOut ? "timeout" : "network"): \(e.localizedDescription)")
            }
            if let e = err { return Apt.reply(c, nil, "network: \(e.localizedDescription)") }
            guard let tmp = tmp, let http = resp as? HTTPURLResponse else { return Apt.reply(c, nil, "network: no HTTP answer") }
            if http.statusCode >= 400 { return Apt.reply(c, nil, "not_found: HTTP \(http.statusCode) for the download") }
            guard let data = try? Data(contentsOf: tmp, options: .mappedIfSafe) else {
                return Apt.reply(c, nil, "network: the download went missing")
            }
            if data.count > maxSize { return Apt.reply(c, nil, "too_large: more than \(maxSize >> 20) MB") }
            guard data.starts(with: Array("!<arch>\n".utf8)) else {
                return Apt.reply(c, nil, "not_found: the vendor's download is not a .deb")
            }
            let fm = FileManager.default
            do {
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                for old in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where old.hasPrefix(pkg + "_") {
                    try? fm.removeItem(at: dir.appendingPathComponent(old))
                }
                try data.write(to: target, options: .atomic)
            } catch { return Apt.reply(c, nil, "helper: can't keep the download: \(error.localizedDescription)") }
            Apt.reply(c, ["body": data.base64EncodedString()], nil)
        }.resume()
    }
}
