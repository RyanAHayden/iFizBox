// F75: what reaches the sideload build from the website, the pure half (the Linux tests build it; App.swift and
// SignBridge.swift do the UIKit and Keychain half). docs/signing.md, "From the website to the app (F75)".
//
//   BundledIdentity    Payload/iFizBox.app/ifizbox-identity.plist: the user's .p12, password and profile, which the
//                      website adds to iFizBox's own IPA as it signs it (F93, Install iFizBox App's bring). Imported
//                      into the Keychain on the first launch that finds it, unless the Keychain already holds one;
//                      the bundle is read-only, so its digest is remembered and the same file is never looked at again.
//                      B420: with one held, a newer profile for the same certificate replaces the held profile, once.
//                      B479: a file with another certificate replaces a held identity that a file brought, or a Free
//                      Apple ID's, once (a second computer install's new certificate revoked the old one).
//   IncomingLink       which ifizbox:// links the shell hands to the page: ifizbox://import?d=… (sources and settings),
//                      ifizbox://install?url=… (F89: the website's Open in iFizBox on an app page), ifizbox://myipas (F77),
//                      ifizbox://add?url=… (N8's Add Source intent), ifizbox://shared?route=… (N9), ifizbox://package?id=… (F96:
//                      the website's Install in iFizBox), ifizbox://account?k=… (F97); nothing else, nothing huge.
//   gunzip(_:)         a gzip member's contents, for the page on an iOS without DecompressionStream (app.gunzip)
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum BundledIdentity {
    static let fileName = "ifizbox-identity.plist"
    static let seenKey = "ifizbox.bundledIdentity" // UserDefaults: the digest of the file last looked at

    struct Contents { let p12: Data; let password: String; let profile: Data }

    // { p12: data, password: string, profile: data } as a property list; nil for anything else.
    static func parse(_ data: Data) -> Contents? {
        guard data.count < 1 << 20,
              let d = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any],
              let p12 = d["p12"] as? Data, !p12.isEmpty, let profile = d["profile"] as? Data, !profile.isEmpty else { return nil }
        return Contents(p12: p12, password: d["password"] as? String ?? "", profile: profile)
    }

    static func digest(_ data: Data) -> String { sha256(data).map { String(format: "%02x", $0) }.joined() }

    // Import this file? Only when it is new (not the one already looked at) and the Keychain holds no identity.
    static func shouldImport(digest: String, seen: String?, hasIdentity: Bool) -> Bool {
        !hasIdentity && digest != seen
    }

    // ---- B420: an update's file with a newer profile for the certificate already held

    // UserDefaults: the digest of the file whose profile was last compared. A key of its own: a file that seenKey
    // marked before this rule existed still gets its one look.
    static let profileSeenKey = "ifizbox.bundledProfile"

    static func shouldCompareProfile(digest: String, seen: String?, hasIdentity: Bool) -> Bool {
        hasIdentity && digest != seen
    }

    // Take the file's profile in place of the held one? Only a strictly newer profile of the same team and App ID, for
    // the certificate held (the file's .p12 holds it too, and the profile lists it), that can sign now and isn't known
    // to leave this iPhone out. In doubt (a date missing), what is held stays.
    static func replacesProfile(_ new: Profile, held: Profile, certificate: Data, fileCertificate: Data?,
                                phone: DeviceCheck.Phone?, now: Date = Date()) -> Bool {
        guard fileCertificate == certificate, new.team == held.team, new.appID == held.appID, !new.appID.isEmpty,
              let made = new.created, let was = held.created, made > was, new.expires != nil,
              new.problem(with: certificate, now: now) == nil, new.devices != 0 else { return false }
        return DeviceCheck.check(profile: new.data, phone: phone).state != .out
    }

    // ---- B479: a computer install's file with another certificate (a new Free Apple ID setup revokes the old one)

    // UserDefaults: the SHA-256 (base64) of the certificate last imported from a file, so a later file knows the held
    // identity came from one.
    static let importedCertKey = "ifizbox.bundledCert"

    // Import the file's identity in place of the held one? Only when the file's certificate is another, newer one that
    // its profile lists and can sign with now, and the held identity is one a file brought (heldFromFile) or a Free Apple
    // ID's (a 7-day team profile): one imported by hand from a paid team stays. In doubt (no profile held, the file's
    // can't be read), what is held stays.
    static func replacesIdentity(fileProfile: Profile?, fileCertificate: Data?, heldCertificate: Data, heldProfile: Profile?,
                                 heldFromFile: Bool, now: Date = Date()) -> Bool {
        guard let fc = fileCertificate, fc != heldCertificate, let fp = fileProfile,
              fp.problem(with: fc, now: now) == nil, fp.devices != 0,
              let made = (try? Certificate(der: fc))?.notBefore, let was = (try? Certificate(der: heldCertificate))?.notBefore,
              made > was else { return false } // only a newer certificate: an old file never brings back a revoked one
        return heldFromFile || heldProfile?.isFree == true
    }

    // The log's line: which profile replaced which.
    static func replacedLine(_ new: Profile, held: Profile) -> String {
        let iso = ISO8601DateFormatter()
        func words(_ p: Profile) -> String {
            "\"\(p.name)\" (made \(p.created.map(iso.string(from:)) ?? "?"), expires \(p.expires.map(iso.string(from:)) ?? "?"))"
        }
        return "the profile inside the app \(words(new)) replaced \(words(held))"
    }
}

enum IncomingLink {
    // myipas: F77, an .ipa opened in iFizBox; add: N8, the Add Source intent (ifizbox://add?url=…)
    // shared: N9, a shared item's route (native/share/, web/app/share.js); install: F89, the website's Open in iFizBox
    // (Import from Safari's signing-import went with the website's signer); package: F96, the website's Install in
    // iFizBox (ifizbox://package?id=…, an app's page)
    // account: F97, a iFizBox Account's link (ifizbox://account?k=…)
    // B14: a tab's own link (ifizbox://sources, ifizbox://changes, …) opens that tab: web/app/router.js ALL_TABS
    static let tabs: Set<String> = ["home", "sources", "changes", "installed", "search", "settings"]
    // free-id: F460b, the website's Finish Setup (ifizbox://free-id#<key>)
    static let hosts: Set<String> = Set(["import", "install", "myipas", "add", "shared", "package", "account", "free-id"]).union(tabs)
    static let maxLength = 512 * 1024

    static func accepts(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "ifizbox", let host = url.host?.lowercased(), hosts.contains(host) else { return false }
        return url.absoluteString.utf8.count <= maxLength
    }
}

// RFC 1952: the header (with any optional fields), raw deflate, then CRC-32 and size, both checked. At most `limit`
// bytes out.
func gunzip(_ d: Data, limit: Int = 8 << 20) throws -> Data {
    let b = [UInt8](d)
    guard b.count >= 18, b[0] == 0x1f, b[1] == 0x8b, b[2] == 8 else { throw ZipError("not gzip data") }
    let flags = b[3]
    var i = 10
    if flags & 4 != 0 { guard i + 2 <= b.count else { throw ZipError("cut short") }; i += 2 + Int(b[i]) + Int(b[i + 1]) << 8 }
    for bit: UInt8 in [8, 16] where flags & bit != 0 { // a file name, a comment: zero-terminated
        while i < b.count && b[i] != 0 { i += 1 }
        i += 1
    }
    if flags & 2 != 0 { i += 2 }
    guard i + 8 <= b.count else { throw ZipError("cut short") }
    var out = Data()
    let inf = try Inflater()
    try inf.feed(Data(b[i..<(b.count - 8)])) { piece in
        out.append(piece)
        if out.count > limit { throw ZipError("too large") }
    }
    guard inf.done else { throw ZipError("cut short") }
    guard crc32Of(out) == le32(b, b.count - 8), UInt32(truncatingIfNeeded: out.count) == le32(b, b.count - 4) else {
        throw ZipError("checksum mismatch")
    }
    return out
}
