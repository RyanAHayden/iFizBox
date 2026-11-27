// Is the signing certificate still good (F14)? An OCSP request (RFC 6960) for it to the responder its own AIA
// extension names (Apple's ocsp.apple.com), and the answer read back: good, revoked (with when), or unknown. The
// answer's signature isn't checked (Feather's checkRevokage doesn't either): it is a warning for the user, not a
// security decision, and iOS makes its own check when the app opens. Also the re-sign reminder's date and words.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum OCSP {
    enum Status: Equatable {
        case good
        case revoked(Date?)
        case unknown
        var name: String {
            switch self { case .good: return "good"; case .revoked: return "revoked"; case .unknown: return "unknown" }
        }
    }

    static let aia = "1.3.6.1.5.5.7.1.1"
    static let ocspMethod = "1.3.6.1.5.5.7.48.1"
    static let basic = "1.3.6.1.5.5.7.48.1.1"

    // The certificate's extensions, by OID: the extnValue's contents.
    static func extensions(_ der: Data) -> [String: Data] {
        guard let cert = try? DER.parse(der), let tbs = cert.children.first,
              let exts = tbs.children.first(where: { $0.tag == 0xA3 })?.children.first else { return [:] }
        var out = [String: Data]()
        for e in exts.children {
            let f = e.children
            guard let oid = f.first, oid.tag == 0x06, let value = f.last, value.tag == 0x04 else { continue }
            out[DER.oidString(oid)] = value.body
        }
        return out
    }

    // The OCSP responder's URL from the certificate's Authority Information Access.
    static func responder(_ der: Data) -> URL? {
        guard let v = extensions(der)[aia], let seq = try? DER.parse(v) else { return nil }
        for ad in seq.children {
            let f = ad.children
            guard f.count == 2, DER.oidString(f[0]) == ocspMethod, f[1].tag == 0x86,
                  let s = String(data: f[1].body, encoding: .ascii), let u = URL(string: s) else { continue }
            return u
        }
        return nil
    }

    // CertID: SHA-1 of the issuer's name and of its public key's bits, and the certificate's serial.
    static func certID(_ cert: Certificate, issuer: Certificate) throws -> Data {
        let spki = try DER.parse(issuer.spki).children
        guard spki.count == 2, spki[1].tag == 0x03, spki[1].body.count > 1 else { throw DER.Bad() }
        let keyBits = spki[1].body.dropFirst()
        return DER.seq([DER.seq([DER.oid("1.3.14.3.2.26"), DER.null]), DER.octets(sha1(cert.issuer)),
                        DER.octets(sha1(Data(keyBits))), cert.serial])
    }

    // OCSPRequest { TBSRequest { requestList { Request { CertID } } } }, no nonce (Apple's responder answers from a
    // cache), unsigned.
    static func request(certificate: Data, issuer: Data) throws -> Data {
        let id = try certID(Certificate(der: certificate), issuer: Certificate(der: issuer))
        return DER.seq([DER.seq([DER.seq([DER.seq([id])])])])
    }

    // The status of `certificate` in an OCSPResponse; throws when it isn't one or the responder answered an error.
    static func status(_ response: Data, certificate: Data) throws -> Status {
        let serial = try Certificate(der: certificate).serial
        let top = try DER.parse(response)
        let f = top.children
        guard top.tag == 0x30, let st = f.first, st.tag == 0x0A else { throw SignError("ocsp", "Not an OCSP response.") }
        guard st.body == Data([0]) else { throw SignError("ocsp", "The OCSP responder answered status \(st.body.first ?? 0xFF).") }
        guard f.count >= 2, f[1].tag == 0xA0, let rb = f[1].children.first, rb.children.count == 2,
              DER.oidString(rb.children[0]) == basic else { throw SignError("ocsp", "The OCSP response has no basic response.") }
        let basicResp = try DER.parse(rb.children[1].body)
        guard let data = basicResp.children.first else { throw SignError("ocsp", "Empty OCSP response.") }
        // ResponseData: [0] version?, responderID ([1] or [2]), producedAt, responses, [1] extensions?
        let fields = data.children.filter { $0.tag != 0xA0 }
        guard fields.count >= 3, fields[2].tag == 0x30 else { throw SignError("ocsp", "Malformed OCSP response.") }
        for single in fields[2].children {
            let s = single.children
            guard s.count >= 3, let certID = s.first?.children, certID.count == 4, certID[3].raw == serial else { continue }
            switch s[1].tag {
            case 0x80: return .good
            case 0xA1: return .revoked(s[1].children.first.flatMap(DER.date))
            default: return .unknown
            }
        }
        return .unknown
    }
}

// The re-sign reminder (F14, the Settings row F13 made): when to remind, and what the notification says.
enum Reminder {
    // `daysBefore` days before `expiry`, at 10:00 local time that day; nil when off (0) or already past.
    static func date(expiry: Date, daysBefore: Int, now: Date = Date(), calendar: Calendar = .current) -> Date? {
        guard daysBefore > 0, let day = calendar.date(byAdding: .day, value: -daysBefore, to: expiry) else { return nil }
        var at = calendar.date(bySettingHour: 10, minute: 0, second: 0, of: day) ?? day
        if at > expiry { at = day }
        return at > now ? at : nil
    }

    static func text(apps: [String], expiry: Date, now: Date = Date(), calendar: Calendar = .current) -> (title: String, body: String) {
        let days = max(0, calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: expiry)).day ?? 0)
        let when = days == 0 ? "today" : days == 1 ? "tomorrow" : "in \(days) days"
        let what: String
        switch apps.count {
        case 0: what = "Your signing certificate"
        case 1: what = apps[0]
        case 2: what = "\(apps[0]) and \(apps[1])"
        default: what = "\(apps[0]) and \(apps.count - 1) other apps"
        }
        let verb = apps.count == 1 || apps.isEmpty ? "stops" : "stop"
        return ("Re-sign Soon", "\(what) \(verb) opening \(when). Open \(Brand.name) and tap Re-sign All.")
    }
}

// Apps iFizBox signed and installed (F14), so Re-sign All can do them again and the reminder can name them. Re-sign
// signs from the IPA kept in Caches (OriginalIPA, F343), else downloads it from its URL again.
struct SignedRecord: Codable, Equatable {
    var bundleID: String          // as installed
    var originalBundleID: String
    var name: String
    var version: String
    var url: String               // where the IPA came from
    var signed: Date
    var expires: Date?            // the earlier of the certificate's and the profile's expiry
    var options: StoredOptions
    var appID: String? = nil      // B138: the application-identifier it was signed with; nil in older records
    var signer: SignerStamp? = nil // B259: the signer that made it; nil in records from before stamps (stale)
    var sha256: String? = nil     // F343: the IPA kept for Re-sign (OriginalIPA), as it came; nil when none is kept
    var certSerial: String? = nil // F458: the certificate it was signed with; nil in older records (signed again)

    struct StoredOptions: Codable, Equatable {
        var name: String?
        var bundleID: String?
        var icon: Data?
        var removeExtensions: [String]
        var fixArm64e: Bool
        // F237: nil in a record written before Keep Bundle IDs, which signed the old way (under the profile's ID):
        // Re-sign keeps doing so, so it replaces the app it installed.
        var keepBundleID: Bool? = nil
        var tweaks: TweakSet? = nil // F288: kept so Re-sign injects the same tweaks
        // B247: the source's app it was signed from (SignOptions.credit), so Re-sign keeps it. Left out of ==: it
        // changes nothing in the signed IPA (My IPAs' "signed with its own options" check compares these).
        var credit: SourceCredit? = nil

        static func == (a: StoredOptions, b: StoredOptions) -> Bool {
            a.name == b.name && a.bundleID == b.bundleID && a.icon == b.icon && a.removeExtensions == b.removeExtensions
                && a.fixArm64e == b.fixArm64e && (a.keepBundleID ?? false) == (b.keepBundleID ?? false) && a.tweaks == b.tweaks
        }
    }

    var json: [String: Any] {
        var j: [String: Any] = ["bundleId": bundleID, "originalBundleId": originalBundleID, "name": name, "version": version,
                                "url": url, "signed": ISO8601DateFormatter().string(from: signed)]
        if let x = expires { j["expires"] = ISO8601DateFormatter().string(from: x) }
        if let t = options.tweaks, !t.names.isEmpty { j["tweaks"] = t.names } // F302a: Installed's "N Tweaks"
        if let s = signer { j["signer"] = s.json } // B259: Needs Re-sign compares it with signing.installed's own
        if let a = appID { j["appId"] = a } // F458: core/freeroute.js asks Apple for its profile
        // B247: core/installed.js matches on it first; its name is the one shown (the user's rename wins)
        if var c = options.credit { c.name = shownName; j["credit"] = c.json }
        return j
    }

    // B247: the name iFizBox shows for it (the reminder, Re-sign's log): the source's name unless the user renamed it.
    var shownName: String { options.name == nil ? options.credit?.name ?? name : name }
}

extension SignOptions {
    var stored: SignedRecord.StoredOptions {
        .init(name: name, bundleID: bundleID, icon: icon, removeExtensions: removeExtensions, fixArm64e: fixArm64e,
              keepBundleID: keepBundleID, tweaks: tweaks, credit: credit)
    }
    init(_ s: SignedRecord.StoredOptions) {
        self.init()
        name = s.name; bundleID = s.bundleID; icon = s.icon; removeExtensions = s.removeExtensions; fixArm64e = s.fixArm64e
        keepBundleID = s.keepBundleID ?? false
        tweaks = s.tweaks
        credit = s.credit
    }
}

enum SignedRecords {
    // The list with `r` in it, replacing an earlier install of the same app (by installed bundle ID).
    static func adding(_ r: SignedRecord, to list: [SignedRecord]) -> [SignedRecord] {
        list.filter { $0.bundleID != r.bundleID } + [r]
    }

    static func encode(_ list: [SignedRecord]) throws -> Data {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.sortedKeys]
        return try e.encode(list)
    }

    static func decode(_ data: Data) -> [SignedRecord] {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return (try? d.decode([SignedRecord].self, from: data)) ?? []
    }

    // F91: the record of one app, for signing.resign: by the bundle ID it was installed as, else its original one.
    static func only(_ list: [SignedRecord], bundleID: String) -> [SignedRecord] {
        guard !bundleID.isEmpty else { return [] }
        if let r = list.first(where: { $0.bundleID == bundleID }) { return [r] }
        return list.first(where: { $0.originalBundleID == bundleID }).map { [$0] } ?? []
    }

    // The earliest expiry of the apps, and their names, for the reminder.
    static func nextExpiry(_ list: [SignedRecord]) -> (Date, [String])? {
        guard let first = list.compactMap(\.expires).min() else { return nil }
        let names = list.filter { $0.expires.map { abs($0.timeIntervalSince(first)) < 86400 } ?? false }.map(\.shownName)
        return (first, names)
    }
}
