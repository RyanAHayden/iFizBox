// Own provisioning profiles, the app's half (web/app/core/asc.js is the page's). With an App Store Connect API key
// (AuthKey_<KeyID>.p8 + Issuer ID) in the Keychain, signing an app with Keep Bundle IDs on makes its own explicit
// App ID (<prefix>.<last component of the app's ID>, with every capability in appIDCaps Apple grants the team: the
// refused ones are remembered per team and skipped; older App IDs are topped up) and an Ad Hoc profile
// with every enabled iPhone and the user's certificate, registering this iPhone first when it's missing. The profile
// is cached per App ID and made again when it's missing, expiring, lacks this iPhone, the App ID's capabilities
// changed or the certificate did. No server: the JWT is ES256 signed here with CryptoKit and goes only to Apple.
// Neither the key nor the JWT is ever logged or handed back to the page.
//
//   asc.key.set {p8, keyId, issuerId}   -> {keyId, issuerId}   (checked: Apple must accept a token from it)
//   asc.key.info                        -> {keyId, issuerId} | null
//   asc.key.remove                      -> true (and the cached profiles go)
//   asc.request {method, path, body}    -> Apple's JSON         host fixed, path /v1/..., for the page's checks
//   asc.profiles                        -> {[identifier]: entry} the cache (core/asc.js profileRows reads it)
//   asc.udid                            -> {udid}  through This iPhone's pairing (the built-in VPN)
// SPDX-License-Identifier: GPL-3.0-or-later
import CryptoKit
import Foundation
import Security

enum ASC {
    struct Key: Codable { let p8: String; let keyId: String; let issuerId: String }
    static let api = "https://api.appstoreconnect.apple.com"
    // core/asc.js APP_ID_CAPS and APP_ID_CAP_SETTINGS (why each is there, and what Apple's API lacks, is written there):
    // every capability of a signing service's profile the API can turn on, Push first.
    static let appIDCaps = ["PUSH_NOTIFICATIONS", "APP_GROUPS", "ASSOCIATED_DOMAINS", "ICLOUD", "GAME_CENTER", "HEALTHKIT", "HOMEKIT", "SIRIKIT", "NETWORK_EXTENSIONS", "PERSONAL_VPN", "MULTIPATH", "HOT_SPOT", "NFC_TAG_READING", "CLASSKIT", "AUTOFILL_CREDENTIAL_PROVIDER", "ACCESS_WIFI_INFORMATION", "COREMEDIA_HLS_LOW_LATENCY", "APPLE_ID_AUTH", "WALLET", "APPLE_PAY", "IN_APP_PURCHASE", "INTER_APP_AUDIO", "WIRELESS_ACCESSORY_CONFIGURATION", "DATA_PROTECTION"]
    static let capSettings: [String: [[String: Any]]] = [
        "ICLOUD": [["key": "ICLOUD_VERSION", "options": [["key": "XCODE_6"]]]],
        "APPLE_ID_AUTH": [["key": "APPLE_ID_AUTH_APP_CONSENT", "options": [["key": "PRIMARY_APP_CONSENT"]]]],
        "DATA_PROTECTION": [["key": "DATA_PROTECTION_PERMISSION_LEVEL", "options": [["key": "COMPLETE_PROTECTION"]]]],
    ]
    static let refusedRetry: TimeInterval = 30 * 86400 // core/asc.js REFUSED_RETRY
    static let service = "com.ryha.ifizbox.asc"

    // ---- the key, in the Keychain (this device only, no backup; read at sign time, so no Face ID)

    static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "key"]
    }
    static func key() -> Key? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return try? JSONDecoder().decode(Key.self, from: d)
    }
    static func save(_ k: Key) throws {
        SecItemDelete(query as CFDictionary)
        var add = OwnKeychain.scoped(query)
        add[kSecValueData as String] = try JSONEncoder().encode(k)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw BridgeError("keychain", "the Keychain refused the API key (\(st))") }
    }
    static func remove() {
        SecItemDelete(query as CFDictionary)
        try? FileManager.default.removeItem(at: cacheDir)
    }

    // ---- JWT (core/asc.js makeJwt: header alg/kid/typ, claims iss/iat/exp/aud, 15 minutes)

    static func jwt(_ k: Key, now: Date = Date()) throws -> String {
        let pk: P256.Signing.PrivateKey
        do { pk = try P256.Signing.PrivateKey(pemRepresentation: k.p8) } catch {
            throw BridgeError("bad_key", "That .p8 isn't an App Store Connect API key.")
        }
        let iat = Int(now.timeIntervalSince1970)
        func part(_ o: [String: Any]) throws -> String { b64url(try JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) }
        let signing = "\(try part(["alg": "ES256", "kid": k.keyId, "typ": "JWT"])).\(try part(["iss": k.issuerId, "iat": iat, "exp": iat + 15 * 60, "aud": "appstoreconnect-v1"]))"
        let sig = try pk.signature(for: Data(signing.utf8))
        return "\(signing).\(b64url(sig.rawRepresentation))"
    }
    static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // ---- requests (blocking: call off the main thread)

    struct Failure: Error { let status: Int; let message: String }

    @discardableResult
    static func request(_ method: String, _ path: String, _ body: [String: Any]? = nil, key k: Key) throws -> [String: Any] {
        guard path.hasPrefix("/v1/"), !path.contains(".."), let url = URL(string: api + path) else {
            throw BridgeError("bad_path", "not an App Store Connect path")
        }
        var r = URLRequest(url: url, timeoutInterval: 30)
        r.httpMethod = method
        r.setValue("Bearer \(try jwt(k))", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let b = body {
            r.httpBody = try JSONSerialization.data(withJSONObject: b)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let done = DispatchSemaphore(value: 0)
        var out: (Data?, URLResponse?, Error?)
        URLSession.shared.dataTask(with: r) { d, resp, e in out = (d, resp, e); done.signal() }.resume()
        done.wait()
        if let e = out.2 { throw Failure(status: 0, message: "Couldn't reach App Store Connect (\(e.localizedDescription)).") }
        let status = (out.1 as? HTTPURLResponse)?.statusCode ?? 0
        let json = out.0.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        if status >= 400 {
            let e = (json["errors"] as? [[String: Any]])?.first
            let text = e?["detail"] as? String ?? e?["title"] as? String ?? "HTTP \(status)"
            throw Failure(status: status, message: "App Store Connect \(method) \(path.split(separator: "?")[0]): \(text)")
        }
        return json
    }

    private static func q(_ items: [String: String]) -> String {
        var c = URLComponents()
        c.queryItems = items.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return "?" + (c.percentEncodedQuery ?? "").replacingOccurrences(of: "[", with: "%5B").replacingOccurrences(of: "]", with: "%5D")
    }
    private static func list(_ j: [String: Any]) -> [[String: Any]] { j["data"] as? [[String: Any]] ?? [] }
    private static func attr(_ o: [String: Any], _ k: String) -> String? { (o["attributes"] as? [String: Any])?[k] as? String }
    private static func rel(_ type: String, _ ids: [String]) -> [String: Any] { ["data": ids.map { ["type": type, "id": $0] }] }

    // ---- naming and the remake rules (core/asc.js appIdFor, appIdPrefix, remakeReason)

    static func appID(for bundleID: String, prefix: String) -> String {
        let last = bundleID.split(separator: ".").last.map(String.init) ?? "app"
        let clean = String(last.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "-" })
        var p = prefix
        if p.hasSuffix(".*") { p.removeLast(2) }
        return "\(p).\(clean)"
    }
    static func prefix(profileAppID: String, team: String) -> String {
        if profileAppID.hasSuffix(".*") { return String(profileAppID.dropLast(2)) }
        if profileAppID != "*", profileAppID.contains(".") { return profileAppID.split(separator: ".").dropLast().joined(separator: ".") }
        return "ifizbox.\(team.lowercased())"
    }
    // Cache entries have core/asc.js's shape: the App ID's capabilities under "capabilities".
    // With no UDID, `candidates` (the running app's embedded profile's devices, one of them this iPhone) stand in:
    // the profile is made again for "device" only when it holds none of them.
    static func remakeReason(_ e: [String: Any]?, udid: String?, candidates: [String] = [], capabilities: [String]?, certId: String?, now: Date = Date()) -> String? {
        guard let e = e, e["content"] is String else { return "missing" }
        guard let x = (e["expires"] as? String).flatMap({ ISO8601DateFormatter().date(from: $0) }), x.timeIntervalSince(now) > 86400 else { return "expired" }
        let had = Set(((e["udids"] as? [String]) ?? []).map { $0.uppercased() })
        if let u = udid, !had.contains(u.uppercased()) { return "device" }
        if udid == nil, !candidates.isEmpty, had.isDisjoint(with: candidates.map { $0.uppercased() }) { return "device" }
        if let c = capabilities, c.sorted() != ((e["capabilities"] as? [String]) ?? []).sorted() { return "capabilities" }
        if let c = certId, let had = e["certId"] as? String, c != had { return "certificate" }
        return nil
    }

    // ---- the cache: Application Support/Signing/auto/<identifier>.json

    static var cacheDir: URL { SignStore.dir.appendingPathComponent("auto", isDirectory: true) }
    static func cached(_ identifier: String) -> [String: Any]? {
        (try? Data(contentsOf: cacheDir.appendingPathComponent("\(identifier).json"))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
    static func store(_ e: [String: Any], _ identifier: String) {
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: e) { try? d.write(to: cacheDir.appendingPathComponent("\(identifier).json"), options: .atomic) }
    }
    static func all() -> [String: Any] {
        var out = [String: Any]()
        for f in (try? FileManager.default.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: nil)) ?? [] where f.pathExtension == "json" {
            if var e = cached(f.deletingPathExtension().lastPathComponent) { e["content"] = nil; out[f.deletingPathExtension().lastPathComponent] = e }
        }
        return out
    }

    static func serialHex(_ der: Data) -> String? {
        guard let c = try? Certificate(der: der), let n = try? DER.parse(c.serial) else { return nil }
        let hex = n.body.map { String(format: "%02X", $0) }.joined()
        let t = hex.drop { $0 == "0" }
        return t.isEmpty ? "0" : String(t)
    }

    // ---- the sign-time step (IPASigner.autoProfile): the profile for this app, or nil to sign with the imported one

    static func profile(for bundleID: String, base: Profile, certDER: Data, log: (String) -> Void) throws -> Profile? {
        guard let k = key() else { return nil }
        let identifier = appID(for: bundleID, prefix: prefix(profileAppID: base.appID, team: base.team))
        var udid = PhoneID.udid
        if udid == nil, IDevice.pairing() != nil { udid = try? IDevice.readUDID() } // This iPhone's pairing knows it
        var entry = cached(identifier)
        var bundleIdId = entry?["bundleIdId"] as? String
        var capsNow: [String]? = nil
        do {
            if let b = bundleIdId { capsNow = try capabilities(of: b, k) }
        } catch let f as Failure where f.status == 404 { bundleIdId = nil; entry = nil }
        if bundleIdId == nil {
            bundleIdId = try ensureAppID(identifier, team: base.team, k, log: log)
            capsNow = try capabilities(of: bundleIdId!, k)
        }
        // App IDs made before the list grew (or by hand) get the missing ones; the profile is then remade by the
        // capabilities rule. What Apple refused for this team isn't asked for again (core/asc.js ensureProfile).
        if let b = bundleIdId, let c = capsNow {
            let skip = refused(team: base.team)
            let ask = appIDCaps.filter { !c.contains($0) && ($0 == "PUSH_NOTIFICATIONS" || !skip.contains($0)) }
            if !ask.isEmpty { capsNow = try addCaps(ask, to: b, team: base.team, pushMust: false, k, log: log) }
        }
        guard let bid = bundleIdId, let capList = capsNow else { return nil }
        guard let serial = serialHex(certDER) else { throw SignError("no_cert", "The certificate can't be read.") }
        if let e = entry, e["serial"] as? String != serial { entry?["content"] = nil; log("Profile \(identifier): the certificate changed") }
        // No UDID: every device in this app's own profile belongs to the team, and this iPhone is one of them.
        var candidates = [String]()
        if udid == nil, case .candidates(let c)? = PhoneID.current() { candidates = c }
        if let e = entry, remakeReason(e, udid: udid, candidates: candidates, capabilities: capList, certId: nil) == nil,
           let c = e["content"] as? String, let d = Data(base64Encoded: c), let p = try? Profile(d) {
            log("Profile \(identifier): made by \(Brand.name), reused")
            return p
        }
        let reason = remakeReason(entry, udid: udid, candidates: candidates, capabilities: capList, certId: nil) ?? "missing"
        if let u = udid {
            if list(try request("GET", "/v1/devices" + q(["filter[udid]": u, "limit": "200"]), key: k)).isEmpty {
                try request("POST", "/v1/devices", ["data": ["type": "devices", "attributes": ["name": "\(Brand.name) iPhone", "udid": u, "platform": "IOS"]]], key: k)
                log("Registered this iPhone (\(u)) in the developer account")
            }
        }
        let cert = list(try request("GET", "/v1/certificates" + q(["limit": "200"]), key: k)).first {
            (attr($0, "serialNumber") ?? "").uppercased().drop { $0 == "0" } == serial.drop { $0 == "0" }
        }
        guard let certId = cert?["id"] as? String else {
            throw SignError("cert_not_in_account", "Your certificate isn't in the developer account this API key belongs to.")
        }
        let devices = list(try request("GET", "/v1/devices" + q(["filter[platform]": "IOS", "filter[status]": "ENABLED", "limit": "200"]), key: k)).compactMap { $0["id"] as? String }
        let name = String("\(Brand.name) \(identifier)".prefix(120))
        for p in list(try request("GET", "/v1/profiles" + q(["filter[name]": name, "limit": "200"]), key: k)) {
            if let id = p["id"] as? String { try request("DELETE", "/v1/profiles/\(id)", key: k) }
        }
        let made = try request("POST", "/v1/profiles", ["data": ["type": "profiles", "attributes": ["name": name, "profileType": "IOS_APP_ADHOC"],
            "relationships": ["bundleId": ["data": ["type": "bundleIds", "id": bid]], "certificates": rel("certificates", [certId]),
                              "devices": rel("devices", devices)]]], key: k)
        guard let data = made["data"] as? [String: Any], let content = attr(data, "profileContent"), let bytes = Data(base64Encoded: content) else {
            throw SignError("bad_profile", "Apple sent no profile.")
        }
        let p = try Profile(bytes)
        let udids = profileUDIDs(bytes)
        var e: [String: Any] = ["identifier": identifier, "bundleIdId": bid, "id": data["id"] as? String ?? "", "name": name, "content": content,
                                "udids": udids, "capabilities": capList, "certId": certId, "serial": serial, "push": p.pushEnvironment ?? NSNull(),
                                "made": ISO8601DateFormatter().string(from: Date())]
        if let x = p.expires { e["expires"] = ISO8601DateFormatter().string(from: x) }
        store(e, identifier)
        log("Profile \(identifier): made by \(Brand.name) (\(reason)), Ad Hoc, \(udids.count) devices" + (p.pushEnvironment.map { ", aps-environment \($0)" } ?? ", no Push"))
        return p
    }

    // No query string: Apple answers 400 to 'limit' on this path (core/asc.js appIdCaps, real call 2026-11-19).
    private static func capabilities(of bundleIdId: String, _ k: Key) throws -> [String] {
        list(try request("GET", "/v1/bundleIds/\(bundleIdId)/bundleIdCapabilities", key: k)).compactMap { attr($0, "capabilityType") }.sorted()
    }

    private static func ensureAppID(_ identifier: String, team: String, _ k: Key, log: (String) -> Void) throws -> String {
        // the filter is a prefix match
        if let b = list(try request("GET", "/v1/bundleIds" + q(["filter[identifier]": identifier, "limit": "200"]), key: k))
            .first(where: { attr($0, "identifier") == identifier }), let id = b["id"] as? String { return id }
        let made = try request("POST", "/v1/bundleIds", ["data": ["type": "bundleIds", "attributes": [
            "identifier": identifier, "name": String("\(Brand.name) \(identifier.split(separator: ".").last ?? "")".prefix(60)), "platform": "IOS"]]], key: k)
        guard let id = (made["data"] as? [String: Any])?["id"] as? String else { throw SignError("bad_profile", "Apple made no App ID.") }
        let caps = try addCaps(appIDCaps, to: id, team: (made["data"] as? [String: Any]).flatMap { attr($0, "seedId") } ?? team, pushMust: true, k, log: log)
        log("Made the App ID \(identifier) with \(caps.count) capabilities")
        return id
    }

    // ---- capabilities Apple refuses: skipped, logged once, remembered per team (core/asc.js addCaps/refusedCaps)
    // Signing/auto/refused.caps: {team: {capabilityType: {at, why}}} (not .json, so all() doesn't list it).

    private static var refusedFile: URL { cacheDir.appendingPathComponent("refused.caps") }
    private static func refusedAll() -> [String: [String: [String: String]]] {
        (try? Data(contentsOf: refusedFile)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: [String: [String: String]]] } ?? [:]
    }
    static func refused(team: String, now: Date = Date()) -> Set<String> {
        let iso = ISO8601DateFormatter()
        return Set((refusedAll()[team.uppercased()] ?? [:]).filter { _, v in
            guard let at = v["at"].flatMap({ iso.date(from: $0) }) else { return false }
            return now.timeIntervalSince(at) < refusedRetry
        }.keys)
    }
    private static func remember(_ cap: String, team: String, why: String) {
        var all = refusedAll()
        all[team.uppercased(), default: [:]][cap] = ["at": ISO8601DateFormatter().string(from: Date()), "why": String(why.prefix(300))]
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: all) { try? d.write(to: refusedFile, options: .atomic) }
    }

    // Asks for `caps`, skipping what's refused for this team, and returns the App ID's capabilities read back. A 4xx
    // other than 401/429 is a refusal: logged once, remembered (Push never: on a new App ID it throws, else it's asked
    // again next sign); one Apple accepts but doesn't turn on is remembered too.
    private static func addCaps(_ caps: [String], to id: String, team: String, pushMust: Bool, _ k: Key, log: (String) -> Void) throws -> [String] {
        let skip = refused(team: team)
        var added = [String]()
        for cap in caps where cap == "PUSH_NOTIFICATIONS" || !skip.contains(cap) {
            var attrs: [String: Any] = ["capabilityType": cap]
            if let s = capSettings[cap] { attrs["settings"] = s }
            do {
                try request("POST", "/v1/bundleIdCapabilities", ["data": ["type": "bundleIdCapabilities", "attributes": attrs,
                    "relationships": ["bundleId": ["data": ["type": "bundleIds", "id": id]]]]], key: k)
                added.append(cap)
            } catch let f as Failure {
                if f.status == 401 || (cap == "PUSH_NOTIFICATIONS" && pushMust) { throw f }
                if (400..<500).contains(f.status), f.status != 429, cap != "PUSH_NOTIFICATIONS" {
                    remember(cap, team: team, why: f.message)
                    log("Capability \(cap): Apple refused it for team \(team) (\(f.message)); skipped from now on")
                } else {
                    log("Capability \(cap): not added this time (\(f.message))")
                }
            }
        }
        let now = try capabilities(of: id, k)
        for cap in added where !now.contains(cap) && cap != "PUSH_NOTIFICATIONS" {
            remember(cap, team: team, why: "accepted but not turned on")
            log("Capability \(cap): Apple accepted it but didn't turn it on for team \(team); skipped from now on")
        }
        return now
    }

    static func profileUDIDs(_ data: Data) -> [String] {
        guard let s = data.range(of: Data("<?xml".utf8)), let e = data.range(of: Data("</plist>".utf8), in: s.lowerBound..<data.endIndex),
              let pl = try? PropertyListSerialization.propertyList(from: data.subdata(in: s.lowerBound..<e.upperBound), format: nil) as? [String: Any]
        else { return [] }
        return pl["ProvisionedDevices"] as? [String] ?? []
    }

    // ---- bridge

    static func register(_ b: Bridge) {
        // The signer asks for a profile per app while it signs (any route: install, My IPAs, sign-ahead, re-sign).
        IPASigner.autoProfile = { bundleID, base, cert, log in
            do { return try profile(for: bundleID, base: base, certDER: cert, log: log) }
            catch let f as Failure { throw SignError("asc", f.message) }
        }
        b.on("asc.key.set") { c in
            Apt.work(c) { () throws -> Any? in
                guard let p8 = c.params["p8"] as? String, p8.contains("PRIVATE KEY"), p8.utf8.count < 4096,
                      let kid = (c.params["keyId"] as? String)?.trimmingCharacters(in: .whitespaces), !kid.isEmpty,
                      let iss = (c.params["issuerId"] as? String)?.trimmingCharacters(in: .whitespaces), !iss.isEmpty
                else { throw BridgeError("bad_key", "The .p8, its Key ID and the Issuer ID are needed.") }
                let k = Key(p8: p8, keyId: kid, issuerId: iss)
                do { try request("GET", "/v1/certificates" + q(["limit": "1"]), key: k) } catch let f as Failure {
                    throw BridgeError(f.status == 401 ? "unauthorized" : "network",
                                      f.status == 401 ? "Apple didn't accept this key: check the Issuer ID and Key ID." : f.message)
                }
                try save(k)
                return ["keyId": kid, "issuerId": iss]
            }
        }
        b.on("asc.key.info") { c in Apt.work(c) { () -> Any? in key().map { ["keyId": $0.keyId, "issuerId": $0.issuerId] } ?? NSNull() } }
        b.on("asc.key.remove") { c in Apt.work(c) { () -> Any? in remove(); return true } }
        b.on("asc.profiles") { c in Apt.work(c) { () -> Any? in all() } }
        b.on("asc.udid") { c in Apt.work(c) { () throws -> Any? in ["udid": try IDevice.readUDID()] } }
        b.on("asc.request") { c in
            Apt.work(c) { () throws -> Any? in
                guard let k = key() else { throw BridgeError("no_key", "No App Store Connect API key is set.") }
                let method = (c.params["method"] as? String ?? "GET").uppercased()
                guard ["GET", "POST", "PATCH", "DELETE"].contains(method), let path = c.params["path"] as? String else {
                    throw BridgeError("bad_path", "GET, POST, PATCH or DELETE to a /v1/ path")
                }
                do { return try request(method, path, c.params["body"] as? [String: Any], key: k) }
                catch let f as Failure { throw BridgeError("asc_\(f.status)", f.message) }
            }
        }
    }
}
