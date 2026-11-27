// What the user changes before signing (F14): the app's name, bundle ID and icon, extensions left out, and the
// arm64e fix-up. IPASigner applies them while it signs; the edits follow Feather's SigningHandler (GPL-3.0,
// khcrysalis/Feather, Feather/Utilities/Handlers/SigningHandler.swift), as docs/sideload.md (R5) reads it.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SignOptions {
    var name: String?                  // the name under the icon: CFBundleDisplayName, and each InfoPlist.strings
    var bundleID: String?              // the ID asked for; the profile still has the last word (Profile.bundleID)
    var icon: Data?                    // a PNG (the page sizes it, 180x180 is best); replaces the app's icon
    var removeExtensions: [String] = [] // paths under the app: "PlugIns/Share.appex", "Watch/W.app"
    var fixArm64e = true
    // F237: keep the app's own bundle ID in Info.plist (the profile's App ID only in the entitlements), so the signed
    // app replaces the original rather than sitting beside it, and gets its own pushes. False: the old way.
    var keepBundleID = true
    // B509: false when the page's params had no keepBundleId: signing still keeps the ID (above), but saved Sign
    // Options record no choice (IPALibrary.setOptions), so Settings' Keep Bundle IDs decides.
    var keepChosen = true
    // F288: tweaks to inject (Tweaks.swift), unpacked and prepared by the page; nil for none.
    var tweaks: TweakSet?
    // F329a: the Lite app's own re-sign with your own icon (AppIcon.swift OwnIcons.selfSource): files of Info.plist's
    // own-icon sets (IconOwnA60x60@2x.png, …) replaced by these PNGs. Unlike `icon`, Info.plist stays as it is, so
    // CFBundleAlternateIcons (every set, the own ones too) is kept. Never stored: the signed bundle holds the picture.
    var ownIconFiles: [String: Data] = [:] {
        didSet { ownIconFiles = ownIconFiles.filter { SignOptions.isOwnIconFile($0.key) && SignOptions.isPNG($0.value) } }
    }
    static func isOwnIconFile(_ name: String) -> Bool {
        name.range(of: "^IconOwn[A-Z][0-9]{1,3}x[0-9]{1,3}@[23]x\\.png$", options: .regularExpression) != nil
    }

    // B247: the source entry this IPA was picked from (a source's app page or the queue): iFizBox's own labels (the sign
    // log, the signed record) name the app by it, since an IPA's Info.plist can name a variant after the app it changes
    // (RyukGram's says "Instagram"). Changes nothing in the IPA.
    var credit: SourceCredit?

    // The name iFizBox shows for the signed app: the user's rename, else the source's name for it, else the IPA's.
    func shownName(_ signedName: String) -> String { name == nil ? credit?.name ?? signedName : signedName }

    init() {}

    // F237: whether this app keeps its ID. F280: iFizBox's own IPA too, whatever ID the running copy has: APNs
    // delivers by the Info.plist ID, so only a copy that kept com.ryha.ifizbox gets push notifications. An update
    // to a copy installed under the profile's ID then installs beside it (the page says so once, core/push.js
    // renamedUpdateNotice). `running` stays for callers and tests that pass it.
    func keeps(_ appBundleID: String, running: String? = Bundle.main.bundleIdentifier) -> Bool {
        keepBundleID
    }
    static let selfBundleID = "com.ryha.ifizbox" // brand.env BRAND_BUNDLE_ID

    // From a bridge call's params: {name, bundleId, icon (base64 PNG), removeExtensions: [path]}.
    init(json p: [String: Any]) throws {
        if let n = (p["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty { name = n }
        if let b = (p["bundleId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !b.isEmpty {
            guard SignOptions.validBundleID(b) else {
                throw SignError("bad_options", "\"\(b)\" isn't a bundle ID (letters, digits, - and ., like com.you.app).")
            }
            bundleID = b
        }
        if let s = p["icon"] as? String, !s.isEmpty {
            guard let d = Data(base64Encoded: s), SignOptions.isPNG(d) else { throw SignError("bad_options", "The icon isn't a PNG.") }
            icon = d
        }
        removeExtensions = (p["removeExtensions"] as? [String] ?? []).map { $0.hasSuffix("/") ? String($0.dropLast()) : $0 }
        if let f = p["fixArm64e"] as? Bool { fixArm64e = f }
        if let k = p["keepBundleId"] as? Bool { keepBundleID = k } else { keepChosen = false } // F237: absent keeps it (the default)
        tweaks = try TweakSet(json: p["tweaks"]) // F288
        credit = SourceCredit(json: p["credit"]) // B247
    }

    static func validBundleID(_ s: String) -> Bool {
        guard s.count <= 155, !s.hasPrefix("."), !s.hasSuffix("."), !s.contains("..") else { return false }
        return s.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII || $0 == "-" || $0 == "." }
    }

    static func isPNG(_ d: Data) -> Bool { d.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) }

    // The icon's file stem in the app: iFizBoxIcon60x60@2x.png and @3x.png (the same bytes; iOS scales).
    static let iconStem = "iFizBoxIcon60x60"
    var iconFiles: [String] { icon == nil ? [] : ["\(SignOptions.iconStem)@2x.png", "\(SignOptions.iconStem)@3x.png"] }

    // The main app's Info.plist with the name and icon changed. CFBundleIconName goes, so iOS takes the loose PNGs
    // rather than the asset catalog's icon (Assets.car stays for the app's other images).
    func apply(toApp pl: inout [String: Any]) {
        if let n = name {
            pl["CFBundleDisplayName"] = n
            pl["CFBundleName"] = n
        }
        if icon != nil {
            let primary: [String: Any] = ["CFBundleIconFiles": [SignOptions.iconStem]]
            for key in ["CFBundleIcons", "CFBundleIcons~ipad"] {
                var icons = pl[key] as? [String: Any] ?? [:]
                icons["CFBundlePrimaryIcon"] = primary
                icons.removeValue(forKey: "CFBundleAlternateIcons")
                if key == "CFBundleIcons" || pl[key] != nil { pl[key] = icons }
            }
            pl.removeValue(forKey: "CFBundleIconFiles")
            pl.removeValue(forKey: "CFBundleIconFile")
            pl.removeValue(forKey: "CFBundleIconName")
        }
    }

    // A localised InfoPlist.strings (text "key" = "value"; or a plist) with the name changed, as a binary plist (iOS
    // reads both); nil when it names neither key, so it stays as it is.
    func renamedStrings(_ data: Data) -> Data? {
        guard let n = name, let d = SignOptions.strings(data) else { return nil }
        guard d["CFBundleDisplayName"] != nil || d["CFBundleName"] != nil else { return nil }
        var out = d
        if d["CFBundleDisplayName"] != nil { out["CFBundleDisplayName"] = n }
        if d["CFBundleName"] != nil { out["CFBundleName"] = n }
        return try? PropertyListSerialization.data(fromPropertyList: out, format: .binary, options: 0)
    }

    // A .strings file as a dictionary: UTF-16 (with a BOM) or UTF-8 text, or a binary/XML plist.
    static func strings(_ data: Data) -> [String: Any]? {
        if let d = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] { return d }
        let text: String?
        if data.starts(with: [0xFF, 0xFE]) || data.starts(with: [0xFE, 0xFF]) { text = String(data: data, encoding: .utf16) }
        else { text = String(data: data, encoding: .utf8) }
        guard let t = text else { return nil }
        return parseStrings(t)
    }

    // The old-style strings format: "key" = "value"; with /* */ and // comments and backslash escapes. Bare words
    // are allowed as keys and values, as the format allows.
    static func parseStrings(_ s: String) -> [String: Any]? {
        let c = Array(s.unicodeScalars)
        var i = 0, out = [String: Any]()
        func skip() {
            while i < c.count {
                if CharacterSet.whitespacesAndNewlines.contains(c[i]) || c[i] == "\u{FEFF}" { i += 1 }
                else if c[i] == "/", i + 1 < c.count, c[i + 1] == "*" {
                    i += 2
                    while i + 1 < c.count, !(c[i] == "*" && c[i + 1] == "/") { i += 1 }
                    i += 2
                } else if c[i] == "/", i + 1 < c.count, c[i + 1] == "/" {
                    while i < c.count, c[i] != "\n" { i += 1 }
                } else { return }
            }
        }
        func token() -> String? {
            skip()
            guard i < c.count else { return nil }
            var r = String.UnicodeScalarView()
            if c[i] == "\"" {
                i += 1
                while i < c.count, c[i] != "\"" {
                    if c[i] == "\\", i + 1 < c.count {
                        i += 1
                        switch c[i] {
                        case "n": r.append("\n")
                        case "t": r.append("\t")
                        case "r": r.append("\r")
                        case "U", "u":
                            let hex = String(String.UnicodeScalarView(c[(i + 1)..<min(i + 5, c.count)]))
                            if let v = UInt32(hex, radix: 16), let u = Unicode.Scalar(v) { r.append(u); i += 4 } else { r.append(c[i]) }
                        default: r.append(c[i])
                        }
                    } else { r.append(c[i]) }
                    i += 1
                }
                guard i < c.count else { return nil }
                i += 1
                return String(r)
            }
            while i < c.count, CharacterSet.alphanumerics.contains(c[i]) || "_.-$:/".unicodeScalars.contains(c[i]) {
                r.append(c[i]); i += 1
            }
            return r.isEmpty ? nil : String(r)
        }
        while true {
            skip()
            if i >= c.count { return out }
            guard let k = token() else { return nil }
            skip()
            guard i < c.count, c[i] == "=" else { return nil }
            i += 1
            guard let v = token() else { return nil }
            skip()
            guard i < c.count, c[i] == ";" else { return nil }
            i += 1
            out[k] = v
        }
    }
}

// B247: a source's app an IPA was signed from: {name, source, sourceName, key} from the page (core/installed.js
// sourceCredit). `name` is the app's name on that source; `source` its URL; `key` the catalog entry. Several sources
// can list apps with one bundle ID (RyukGram and Instagram), so this, not the ID, says which one was installed.
struct SourceCredit: Codable, Equatable {
    var name: String
    var source: String?
    var sourceName: String?
    var key: String?

    init?(json: Any?) {
        guard let p = json as? [String: Any] else { return nil }
        func text(_ k: String) -> String? {
            let s = (p[k] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return s.isEmpty ? nil : String(s.prefix(500))
        }
        guard let n = text("name") else { return nil }
        name = n; source = text("source"); sourceName = text("sourceName"); key = text("key")
    }

    var json: [String: Any] {
        var j: [String: Any] = ["name": name]
        if let s = source { j["source"] = s }
        if let s = sourceName { j["sourceName"] = s }
        if let k = key { j["key"] = k }
        return j
    }
}

// Feather's arm64e fix-up (`_locateMachosAndFixupArm64eSlice`, calling LiveContainer's `LCPatchMachOFixupARM64eSlice`,
// Apache-2.0, LiveContainer commit 3a029b6): a fat binary's arm64e slice built for the old pointer-auth ABI (CPU
// subtype exactly CPU_SUBTYPE_ARM64E, no ABI bits) gets CPU_SUBTYPE_LIB64 (0x80000000) set, in the slice's own
// header and in the fat header. iOS 26 refuses the old one ("cpu type/subtype in slice (arm64e.old) does not match
// fat header (arm64e)"); CydiaSubstrate in tweaked IPAs is the usual case. Rewritten here in Swift on Data.
enum Arm64e {
    static let cpuARM64: UInt32 = 0x0100_000C
    static let subARM64E: UInt32 = 2
    static let lib64: UInt32 = 0x8000_0000

    // The binary with the fix applied, and whether anything changed.
    static func fixup(_ file: Data) -> (Data, Bool) {
        guard file.count >= 8, file.be32(at: 0) == MachO.fatMagic else { return (file, false) }
        var d = file
        let n = Int(file.be32(at: 4))
        for i in 0..<n {
            let o = 8 + i * 20
            guard o + 20 <= d.count else { break }
            guard d.be32(at: o) == cpuARM64, d.be32(at: o + 4) == subARM64E else { continue }
            let off = Int(d.be32(at: o + 8))
            guard off + 28 <= d.count, d.le32(at: off) == MachO.magic64 else { continue }
            let sub = d.le32(at: off + 8) | lib64
            d.putLE32(sub, at: off + 8)
            d.putBE32(sub, at: o + 4)
            return (d, true) // LiveContainer stops at the first one, as a fat file has one arm64e slice
        }
        return (file, false)
    }
}

extension Data {
    mutating func putBE32(_ v: UInt32, at i: Int) {
        for k in 0..<4 { self[startIndex + i + k] = UInt8(truncatingIfNeeded: v >> (24 - 8 * UInt32(k))) }
    }
}
