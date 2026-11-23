// The sideload build's signing identity (I6): the user's .p12 goes into the iOS Keychain (this device only, never
// synced or backed up) and is used there. F73: the imported .p12 file and its password are also kept, as one Keychain
// generic-password item (this device only), so signing.export can hand them to iFizBox Account's certificate sync
// (screens/account.js); signing.remove deletes it with the identity. The profile is a plain file in
// Application Support (it holds no secret). B276: the certificate's SHA-256 and the profile are also kept in the
// Keychain, so deleting and reinstalling the app comes back with its certificate. docs/signing.md, "On the phone (I6)".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import os
import Security

enum SignStore {
    // B286: iOS 27's syslog shows an NSLog line only as <private>; os_log with %{public}@ keeps it readable.
    private static let osLog = OSLog(subsystem: "ifizbox.signing", category: "keychain")
    private static func say(_ s: String) { os_log("%{public}@", log: osLog, type: .default, s) }

    static let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Signing", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    static var profileURL: URL { dir.appendingPathComponent("profile.mobileprovision") }
    static let certKey = "ifizbox.signing.certSHA256"
    static let label = "\(Brand.name) signing identity"

    // ---- the user's identity

    static func importIdentity(p12: Data, password: String, profile profileData: Data) throws -> Profile {
        let profile = try Profile(profileData)
        var items: CFArray?
        let rc = SecPKCS12Import(p12 as CFData, [kSecImportExportPassphrase as String: password] as CFDictionary, &items)
        if rc == errSecAuthFailed { throw SignError("wrong_password", "The password doesn't open that .p12.") }
        guard rc == errSecSuccess, let first = (items as? [[String: Any]])?.first,
              let idRef = first[kSecImportItemIdentity as String] else {
            throw SignError("bad_p12", "That file isn't a .p12 with a certificate and its key (\(rc)).")
        }
        let identity = idRef as! SecIdentity // swiftlint:disable:this force_cast
        var certRef: SecCertificate?
        guard SecIdentityCopyCertificate(identity, &certRef) == errSecSuccess, let cert = certRef else {
            throw SignError("bad_p12", "The .p12 has no certificate.")
        }
        let der = SecCertificateCopyData(cert) as Data
        if let problem = profile.problem(with: der) { throw problem }
        removeIdentity()
        let add = OwnKeychain.scoped([kSecValueRef as String: identity, kSecAttrLabel as String: label,
                                      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly])
        var st = SecItemAdd(add as CFDictionary, nil)
        if st == errSecDuplicateItem { // the same identity imported before: keep that one
            st = errSecSuccess
        }
        guard st == errSecSuccess else { throw SignError("keychain", "The Keychain refused the identity (\(st)).") }
        try keepP12(p12, password: password, certSHA256: sha256(der).base64EncodedString()) // F73
        try profileData.write(to: profileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        UserDefaults.standard.set(sha256(der).base64EncodedString(), forKey: certKey)
        keepSetup(certSHA256: sha256(der).base64EncodedString(), profile: profileData)
        return profile
    }

    static func identity() -> SecIdentity? {
        _ = restored
        guard let want = UserDefaults.standard.string(forKey: certKey) else { return nil }
        let q: [String: Any] = [kSecClass as String: kSecClassIdentity, kSecMatchLimit as String: kSecMatchLimitAll,
                                kSecReturnRef as String: true]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let all = out as? [SecIdentity] else { return nil }
        return all.first { certificateDER($0).map { sha256($0).base64EncodedString() } == want }
    }

    // The identity in use as its two Keychain items, the certificate and its key (matched by the public key's SHA-1,
    // as iOS fills kSecAttrPublicKeyHash and kSecAttrApplicationLabel), for OwnKeychain.move. Empty without one.
    static func identityQueries() -> [[String: Any]] {
        var c: SecCertificate?
        guard let id = identity(), SecIdentityCopyCertificate(id, &c) == errSecSuccess, let cert = c,
              let pub = SecCertificateCopyKey(cert), let ext = SecKeyCopyExternalRepresentation(pub, nil) as Data? else { return [] }
        let hash = sha1(ext)
        return [[kSecClass as String: kSecClassCertificate, kSecAttrPublicKeyHash as String: hash],
                [kSecClass as String: kSecClassKey, kSecAttrApplicationLabel as String: hash]]
    }

    static func certificateDER(_ id: SecIdentity) -> Data? {
        var c: SecCertificate?
        guard SecIdentityCopyCertificate(id, &c) == errSecSuccess, let cert = c else { return nil }
        return SecCertificateCopyData(cert) as Data
    }

    static func profile() -> Profile? {
        _ = restored
        return (try? Data(contentsOf: profileURL)).flatMap { try? Profile($0) }
    }

    // ---- B276: what finds the identity, kept in the Keychain so a reinstall comes back with its certificate

    // The identity itself is in the Keychain, which outlives the app's container while the signing team stays the
    // same; the certificate's SHA-256 (certKey, which picks it out) and the profile file don't. Both are kept as
    // generic-password items too (no secret: the SHA-256 of a public certificate and a profile), this device only,
    // as Install Apps With (KeptRoute). Remove Certificate deletes them.
    static let keepService = "com.ryha.ifizbox.signing.setup"
    static let keepCertAccount = "cert", keepProfileAccount = "profile"

    static func keepQuery(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keepService,
         kSecAttrAccount as String: account]
    }

    static func readKept(_ account: String) -> Data? {
        var q = keepQuery(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    // nil deletes it. A refusal is logged, never thrown: the container's copy still works until the next reinstall.
    static func writeKept(_ account: String, _ data: Data?) {
        let q = keepQuery(account)
        guard let data = data else { SecItemDelete(q as CFDictionary); return }
        if readKept(account) == data { return }
        var st = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if st == errSecItemNotFound {
            var add = OwnKeychain.scoped(q)
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            add[kSecAttrLabel as String] = "\(Brand.name) signing setup"
            st = SecItemAdd(add as CFDictionary, nil)
        }
        if st != errSecSuccess { NSLog("\(Brand.name) keychain refused the signing \(account) (\(st))") }
    }

    static func keepSetup(certSHA256: String, profile: Data) {
        writeKept(keepCertAccount, Data(certSHA256.utf8))
        writeKept(keepProfileAccount, profile)
    }

    // The certificate's SHA-256 the F73 .p12 item names, for a phone whose setup was imported before B276.
    static func p12CertSHA256() -> String? {
        var q = p12Query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let blob = out as? Data,
              let d = try? PropertyListSerialization.propertyList(from: blob, format: nil) as? [String: Any] else { return nil }
        return d["cert"] as? String
    }

    // Once per launch, before the identity or the profile is first looked up. A fresh container (deleted and
    // reinstalled) gets certKey and the profile file back from the Keychain; a container that has them while the
    // Keychain doesn't (imported before B276) puts them there, so the next reinstall keeps them.
    static let restored: Void = {
        let defaults = UserDefaults.standard
        if let want = defaults.string(forKey: certKey) {
            writeKept(keepCertAccount, Data(want.utf8))
        } else if let kept = readKept(keepCertAccount).flatMap({ String(data: $0, encoding: .utf8) }) ?? p12CertSHA256() {
            defaults.set(kept, forKey: certKey)
            say("\(Brand.name): signing certificate restored from the keychain")
        }
        guard defaults.string(forKey: certKey) != nil else { return }
        if let file = try? Data(contentsOf: profileURL) {
            writeKept(keepProfileAccount, file)
        } else if let kept = readKept(keepProfileAccount), (try? Profile(kept)) != nil {
            do {
                try kept.write(to: profileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                say("\(Brand.name): signing profile restored from the keychain")
            } catch { say("\(Brand.name): signing profile not restored: \(error)") }
        }
    }()

    static func removeIdentity() {
        if let id = identity() {
            var c: SecCertificate?
            var k: SecKey?
            if SecIdentityCopyCertificate(id, &c) == errSecSuccess, let c = c {
                SecItemDelete([kSecClass as String: kSecClassCertificate, kSecValueRef as String: c] as CFDictionary)
            }
            if SecIdentityCopyPrivateKey(id, &k) == errSecSuccess, let k = k {
                SecItemDelete([kSecClass as String: kSecClassKey, kSecValueRef as String: k] as CFDictionary)
            }
        }
        deleteP12() // F73
        writeKept(keepCertAccount, nil) // B276
        writeKept(keepProfileAccount, nil)
        UserDefaults.standard.removeObject(forKey: certKey)
        try? FileManager.default.removeItem(at: profileURL)
    }

    // ---- F73: the .p12 as imported, for signing.export

    static let p12Service = "com.ryha.ifizbox.signing.p12"
    static let p12Account = "identity"
    static var p12Query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: p12Service,
         kSecAttrAccount as String: p12Account]
    }

    // One generic-password item: a binary plist {p12, password, cert} (cert: the certificate's SHA-256, base64, so a
    // stale item never goes out with another identity). This device only: never synced to iCloud or in a backup.
    static func keepP12(_ p12: Data, password: String, certSHA256: String) throws {
        deleteP12()
        let blob = try PropertyListSerialization.data(fromPropertyList: ["p12": p12, "password": password, "cert": certSHA256],
                                                      format: .binary, options: 0)
        var add = OwnKeychain.scoped(p12Query)
        add[kSecValueData as String] = blob
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrLabel as String] = "\(Brand.name) signing .p12"
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw SignError("keychain", "The Keychain refused the .p12 (\(st)).") }
    }

    // The kept .p12 and password, when they belong to the identity in use; nil when there is none (no certificate,
    // or one imported before F73: the user imports it again for iFizBox to update itself through the Signing Server).
    static func exportP12() -> (p12: Data, password: String)? {
        _ = restored
        guard let want = UserDefaults.standard.string(forKey: certKey) else { return nil }
        var q = p12Query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let blob = out as? Data,
              let d = try? PropertyListSerialization.propertyList(from: blob, format: nil) as? [String: Any],
              let p12 = d["p12"] as? Data, let pw = d["password"] as? String, d["cert"] as? String == want else { return nil }
        return (p12, pw)
    }

    static func deleteP12() {
        SecItemDelete(p12Query as CFDictionary)
    }

    // ---- F75: what the old local HTTPS install mode left behind (its CA and TLS keys, their certificates)

    static func deleteKey(tag: String) {
        SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: Data(tag.utf8)] as CFDictionary)
    }

    // Once per launch at most, cheap when there is nothing: the CA and TLS keys, the TLS certificate and the two
    // DER files of 0.1.x's Local Install, which nothing uses any more. The user removes the old profile in Settings.
    static func removeOldInstallCA() {
        let ca = dir.appendingPathComponent("localca.der"), leaf = dir.appendingPathComponent("localtls.der")
        guard FileManager.default.fileExists(atPath: ca.path) || FileManager.default.fileExists(atPath: leaf.path) else { return }
        deleteKey(tag: "com.ryha.ifizbox.localca")
        deleteKey(tag: "com.ryha.ifizbox.localtls")
        SecItemDelete([kSecClass as String: kSecClassCertificate, kSecAttrLabel as String: "\(Brand.name) local install TLS"] as CFDictionary)
        try? FileManager.default.removeItem(at: ca)
        try? FileManager.default.removeItem(at: leaf)
    }
}

// The Keychain identity as the signer sees it: the key signs inside Security.framework, the certificates go into
// the CMS with Apple's WWDR intermediate and root (bundled in iFizBox.app/certs/, public certificates from
// apple.com/certificateauthority) so iOS can build the chain.
struct KeychainIdentity: SigningIdentity {
    let key: SecKey
    let certificate: Data
    let chain: [Data]
    let signatureAlgorithm: String

    init(_ id: SecIdentity) throws {
        var k: SecKey?
        guard SecIdentityCopyPrivateKey(id, &k) == errSecSuccess, let key = k, let der = SignStore.certificateDER(id) else {
            throw SignError("keychain", "The signing identity can't be read from the Keychain.")
        }
        self.key = key
        certificate = der
        let type = (SecKeyCopyAttributes(key) as? [String: Any])?[kSecAttrKeyType as String] as? String
        signatureAlgorithm = type == (kSecAttrKeyTypeECSECPrimeRandom as String) ? "1.2.840.10045.4.3.2" : "1.2.840.113549.1.1.1"
        chain = KeychainIdentity.issuers(of: der)
    }

    static func issuers(of leaf: Data) -> [Data] {
        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("certs"),
              let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        let pool = names.filter { $0.hasSuffix(".cer") }.compactMap { try? Data(contentsOf: dir.appendingPathComponent($0)) }
            .compactMap { try? Certificate(der: $0) }
        var out = [Data]()
        var cur = try? Certificate(der: leaf)
        while let c = cur, c.issuer != c.subject, let up = pool.first(where: { $0.subject == c.issuer }), !out.contains(up.der) {
            out.append(up.der)
            cur = up
        }
        return out
    }

    func sign(_ message: Data) throws -> Data {
        let alg: SecKeyAlgorithm = signatureAlgorithm == "1.2.840.10045.4.3.2"
            ? .ecdsaSignatureMessageX962SHA256 : .rsaSignatureMessagePKCS1v15SHA256
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(key, alg, message as CFData, &err) else {
            throw SignError("keychain", "The Keychain couldn't sign: \(err?.takeRetainedValue().localizedDescription ?? "?")")
        }
        return sig as Data
    }
}
