// F77: My IPAs, the user's own IPAs kept in the app's Documents (visible in Files under On My iPhone > iFizBox, so
// IPAs can be dropped in from Files too) and signed on the phone, ahead of time or as they install. Foundation only,
// so native/sign/tests runs it on Linux; the bridge calls (library.*) are native/Sources/MyIPAs.swift.
//
//   root   (Documents)                        <name>.ipa: the user's IPAs, as added; nothing else of ours goes here
//   store  (Application Support/MyIPAs)       <name>.ipa.json   what the IPA is (cached by size and date), its icon
//                                             <name>.ipa.options.json  the user's Sign Options for it
//                                             <name>.ipa.signed  the signed copy;  <name>.ipa.signed.json  about it
//
// A signed copy counts only while it still fits: the IPA is the same file (size and date), it was signed with the
// certificate in use, with the Sign Options set now, and its signature hasn't expired. Otherwise it's "Not signed
// yet" and the next Sign Now or Install signs again.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct IPALibrary {
    let root: URL
    let store: URL
    // The app turns Apple's CgBI icon (which no browser draws) into a plain PNG, small enough for the list.
    var iconFix: (Data) -> Data? = { $0 }

    init(root: URL, store: URL) {
        self.root = root
        self.store = store
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: store, withIntermediateDirectories: true)
    }

    struct Ext: Codable, Equatable { var path: String; var bundleID: String; var name: String; var point: String }

    // What an IPA is, read once from the file and kept while its size and date stay the same.
    struct Details: Codable {
        var size: UInt64
        var modified: Date
        var name: String
        var bundleID: String
        var version: String
        var minimumOS: String
        var extensions: [Ext]
        var icon: Data?
        var error: String?          // the IPA doesn't read (not an IPA, more than one app): listed, can't be signed
    }

    // The signed copy, and what it was made from.
    struct Signed: Codable {
        var sourceSize: UInt64
        var sourceModified: Date
        var certificate: String     // SHA-1 of the certificate's DER, hex
        var options: SignedRecord.StoredOptions
        var bundleID: String
        var originalBundleID: String
        var name: String
        var version: String
        var removed: [String]
        var fixedArm64e: [String]
        var signed: Date
        var expires: Date?
        var signer: SignerStamp? = nil // B259: nil in a copy signed before stamps, which signed() no longer hands out
        var appID: String? = nil       // the application-identifier it was signed with (TEAM.id); nil in an older copy

        var app: SignedApp {
            SignedApp(bundleID: bundleID, originalBundleID: originalBundleID, name: name, version: version, removed: removed,
                      fixedArm64e: fixedArm64e, appID: appID)
        }
    }

    // ---- names

    // A file name in the library: one path component ending in .ipa, not hidden.
    static func validName(_ s: String) -> Bool {
        !s.isEmpty && s.count <= 255 && !s.hasPrefix(".") && !s.contains("/") && !s.contains("\\") && s != ".." &&
            s.lowercased().hasSuffix(".ipa") && !s.unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7F }
    }

    // What a wanted name (a URL's last part, a picked file's name) becomes: no folders, no control characters, no
    // leading dots, ending in .ipa.
    static func safeName(_ wanted: String) -> String {
        var s = wanted.removingPercentEncoding ?? wanted
        s = String(s.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last ?? "")
        s = String(s.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7F && $0 != ":" }.map(Character.init))
        s = s.trimmingCharacters(in: .whitespaces)
        while s.hasPrefix(".") { s.removeFirst() }
        if s.lowercased().hasSuffix(".ipa") { s = String(s.dropLast(4)) }
        s = s.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { s = "App" }
        if s.count > 200 { s = String(s.prefix(200)) }
        return s + ".ipa"
    }

    // `wanted` made safe, then "Name 2.ipa", "Name 3.ipa"... while one of that name is there.
    func uniqueName(_ wanted: String) -> String {
        let base = IPALibrary.safeName(wanted)
        let stem = String(base.dropLast(4))
        var name = base, n = 2
        while FileManager.default.fileExists(atPath: root.appendingPathComponent(name).path) {
            name = "\(stem) \(n).ipa"; n += 1
        }
        return name
    }

    func url(_ file: String) throws -> URL {
        guard IPALibrary.validName(file) else { throw SignError("bad_request", "\"\(file)\" isn't an IPA in My IPAs.") }
        let u = root.appendingPathComponent(file)
        guard FileManager.default.fileExists(atPath: u.path) else { throw SignError("gone", "\(file) isn't in My IPAs any more.") }
        return u
    }

    private func side(_ file: String, _ suffix: String) -> URL { store.appendingPathComponent(file + suffix) }
    func signedURL(_ file: String) -> URL { side(file, ".signed") }

    // ---- the list

    // The IPAs in Documents, A to Z by name without .ipa ("Rich" before "Rich 2").
    func files() -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return names.filter(IPALibrary.validName).sorted { String($0.dropLast(4)).localizedStandardCompare(String($1.dropLast(4))) == .orderedAscending }
    }

    private func stat(_ u: URL) -> (UInt64, Date) {
        let a = (try? FileManager.default.attributesOfItem(atPath: u.path)) ?? [:]
        return ((a[.size] as? NSNumber)?.uint64Value ?? 0, a[.modificationDate] as? Date ?? Date(timeIntervalSince1970: 0))
    }

    private static func same(_ a: Date, _ b: Date) -> Bool { abs(a.timeIntervalSince(b)) < 0.001 }

    func details(_ file: String) throws -> Details {
        let u = try url(file)
        let (size, modified) = stat(u)
        let cache = side(file, ".json")
        if let d = (try? Data(contentsOf: cache)).flatMap({ try? IPALibrary.decoder.decode(Details.self, from: $0) }),
           d.size == size, IPALibrary.same(d.modified, modified) { return d }
        var out: Details
        do {
            let a = try Inspect.ipa(u)
            var icon: Data?
            if let path = a.iconPath, let z = try? ZipReader(url: u), let e = z.entries.first(where: { $0.name == path }),
               let png = try? z.data(e, limit: 4 << 20) { icon = iconFix(png) }
            out = Details(size: size, modified: modified, name: a.name, bundleID: a.bundleID, version: a.version,
                          minimumOS: a.minimumOS,
                          extensions: a.extensions.map { Ext(path: $0.path, bundleID: $0.bundleID, name: $0.name, point: $0.point) },
                          icon: icon, error: nil)
        } catch {
            let why = (error as? SignError)?.message ?? (error as? ZipError).map { "\($0)" } ?? "\(error)"
            out = Details(size: size, modified: modified, name: String(file.dropLast(4)), bundleID: "", version: "",
                          minimumOS: "", extensions: [], icon: nil, error: why)
        }
        if let data = try? IPALibrary.encoder.encode(out) { try? data.write(to: cache, options: .atomic) }
        return out
    }

    // ---- Sign Options

    func options(_ file: String) -> SignOptions {
        guard let d = try? Data(contentsOf: side(file, ".options.json")),
              let s = try? IPALibrary.decoder.decode(SignedRecord.StoredOptions.self, from: d) else { return SignOptions() }
        return SignOptions(s)
    }

    // F243: whether the user saved Sign Options for this IPA (library.options). Without, Keep Bundle IDs is the
    // global setting the page sends (`keep`); with, the file's own switch (nil in one saved before F237: the old way).
    func hasOptions(_ file: String) -> Bool { FileManager.default.fileExists(atPath: side(file, ".options.json").path) }

    // The options a sign of this IPA uses: its own, or the defaults with Keep Bundle IDs as `keep` (nil: on).
    func options(_ file: String, keep: Bool?) -> SignOptions {
        var o = options(file)
        if !hasOptions(file), let k = keep { o.keepBundleID = k }
        return o
    }

    // Keeps the options; a signed copy made with others no longer counts, so it goes.
    func setOptions(_ file: String, _ o: SignOptions) throws {
        _ = try url(file)
        try IPALibrary.encoder.encode(o.stored).write(to: side(file, ".options.json"), options: .atomic)
        if let s = rawSigned(file), s.options != o.stored { dropSigned(file) }
    }

    // ---- the signed copy

    private func rawSigned(_ file: String) -> Signed? {
        guard FileManager.default.fileExists(atPath: signedURL(file).path),
              let d = try? Data(contentsOf: side(file, ".signed.json")) else { return nil }
        return try? IPALibrary.decoder.decode(Signed.self, from: d)
    }

    // The signed copy while it still fits (above); nil otherwise. `certificate`: the DER in use (nil: none, so no
    // copy counts). F243: `keep`, the global Keep Bundle IDs (options(_:keep:)): a copy signed the other way doesn't count.
    func signed(_ file: String, certificate: Data?, now: Date = Date(), keep: Bool? = nil) -> Signed? {
        guard let cert = certificate, let s = rawSigned(file), let u = try? url(file) else { return nil }
        let (size, modified) = stat(u)
        guard s.sourceSize == size, IPALibrary.same(s.sourceModified, modified), s.certificate == IPALibrary.hex(sha1(cert)),
              s.options == options(file, keep: keep).stored else { return nil }
        if let x = s.expires, x <= now { return nil }
        guard let stamp = s.signer, !stamp.isStale() else { return nil } // B259: an older signer's copy is signed again
        return s
    }

    func dropSigned(_ file: String) {
        try? FileManager.default.removeItem(at: signedURL(file))
        try? FileManager.default.removeItem(at: side(file, ".signed.json"))
    }

    // Signs the IPA with its Sign Options into the signed copy (replacing any earlier one). Offline: nothing leaves
    // the phone. `expires`: the signature's end (the certificate's or the profile's, the earlier). F243: `keep`, the
    // global Keep Bundle IDs, for an IPA without Sign Options of its own (options(_:keep:)).
    @discardableResult
    func sign(_ file: String, signer: IPASigner, certificate: Data, expires: Date?, work: URL,
              progress: ((String, Double) -> Void)? = nil, keep: Bool? = nil) throws -> Signed {
        let u = try url(file)
        let (size, modified) = stat(u)
        let opts = options(file, keep: keep)
        signer.options = opts
        let tmp = work.appendingPathComponent("lib-\(UUID().uuidString).ipa")
        defer { try? FileManager.default.removeItem(at: tmp) }
        let app = try signer.sign(u, to: tmp, progress: progress)
        let s = Signed(sourceSize: size, sourceModified: modified, certificate: IPALibrary.hex(sha1(certificate)),
                       options: opts.stored, bundleID: app.bundleID, originalBundleID: app.originalBundleID, name: app.name,
                       version: app.version, removed: app.removed, fixedArm64e: app.fixedArm64e, signed: signer.time,
                       expires: expires, signer: app.stamp, appID: app.appID)
        dropSigned(file)
        try FileManager.default.moveItem(at: tmp, to: signedURL(file))
        try IPALibrary.encoder.encode(s).write(to: side(file, ".signed.json"), options: .atomic)
        return s
    }

    // B229: an IPA the IPA queue signed from this file (SignAhead's signing.prepare {library}) kept as its signed copy,
    // so a row installed that way reads Signed and Install doesn't sign it again. Only a copy signed with the options a
    // sign here would use (options(_:keep:)) is kept; the rest are left alone. `from` is copied, not moved (the queue
    // still serves it). -> whether it was kept.
    @discardableResult
    func keepSigned(_ file: String, from: URL, app: SignedApp, options: SignOptions, certificate: Data, signed: Date,
                    expires: Date?, keep: Bool? = nil) throws -> Bool {
        let u = try url(file)
        guard options.stored == self.options(file, keep: keep).stored else { return false }
        let (size, modified) = stat(u)
        let tmp = store.appendingPathComponent(".\(UUID().uuidString).keep")
        defer { try? FileManager.default.removeItem(at: tmp) }
        try FileManager.default.createDirectory(at: store, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: from, to: tmp)
        let s = Signed(sourceSize: size, sourceModified: modified, certificate: IPALibrary.hex(sha1(certificate)),
                       options: options.stored, bundleID: app.bundleID, originalBundleID: app.originalBundleID, name: app.name,
                       version: app.version, removed: app.removed, fixedArm64e: app.fixedArm64e, signed: signed, expires: expires,
                       signer: app.stamp, appID: app.appID)
        dropSigned(file)
        try FileManager.default.moveItem(at: tmp, to: signedURL(file))
        try IPALibrary.encoder.encode(s).write(to: side(file, ".signed.json"), options: .atomic)
        return true
    }

    // ---- adding and deleting

    // Puts `from` into the library as (a free version of) `name`; moved when `move`, else copied. Answers the name.
    @discardableResult
    func add(_ from: URL, name: String, move: Bool) throws -> String {
        let n = uniqueName(name)
        let dest = root.appendingPathComponent(n)
        if move { try FileManager.default.moveItem(at: from, to: dest) } else { try FileManager.default.copyItem(at: from, to: dest) }
        return n
    }

    func delete(_ file: String) throws {
        guard IPALibrary.validName(file) else { throw SignError("bad_request", "\"\(file)\" isn't an IPA in My IPAs.") }
        try? FileManager.default.removeItem(at: root.appendingPathComponent(file))
        dropSigned(file)
        for s in [".json", ".options.json"] { try? FileManager.default.removeItem(at: side(file, s)) }
    }

    // Leftovers of IPAs no longer in Documents (deleted in Files): their cache, options and signed copies.
    func sweep() {
        let keep = Set(files())
        for n in (try? FileManager.default.contentsOfDirectory(atPath: store.path)) ?? [] {
            guard let r = n.range(of: ".ipa", options: [.caseInsensitive, .backwards]) else { continue }
            let file = String(n[..<r.upperBound])
            if !keep.contains(file) { try? FileManager.default.removeItem(at: store.appendingPathComponent(n)) }
        }
    }

    // ---- for the page

    // One IPA as library.list hands it to the page (web/app/core/myipas.js reads it).
    // F243: options.keepBundleId is null without Sign Options of its own (the global setting decides); `keep` is that
    // setting, for whether the signed copy counts.
    func json(_ file: String, certificate: Data?, now: Date = Date(), keep: Bool? = nil) -> [String: Any] {
        guard let d = try? details(file) else { return ["file": file, "error": "gone"] }
        let iso = ISO8601DateFormatter()
        var j: [String: Any] = ["file": file, "name": d.name, "bundleId": d.bundleID, "version": d.version, "size": d.size,
                                "minimumOS": d.minimumOS, "added": iso.string(from: d.modified),
                                "extensions": d.extensions.map { ["path": $0.path, "bundleId": $0.bundleID, "name": $0.name, "point": $0.point] },
                                "icon": d.icon?.base64EncodedString() ?? NSNull(), "error": d.error ?? NSNull()]
        let o = options(file)
        j["options"] = ["name": o.name.map { $0 as Any } ?? NSNull(), "bundleId": o.bundleID.map { $0 as Any } ?? NSNull(), "icon": o.icon?.base64EncodedString() ?? NSNull(),
                        "removeExtensions": o.removeExtensions, "fixArm64e": o.fixArm64e,
                        "keepBundleId": hasOptions(file) ? o.keepBundleID as Any : NSNull(),
                        "tweaks": (o.tweaks?.names ?? []) as Any] as [String: Any] // F288: the names only; the page keeps the files per app
        if let s = signed(file, certificate: certificate, now: now, keep: keep) {
            var sj: [String: Any] = ["at": iso.string(from: s.signed), "bundleId": s.bundleID, "name": s.name, "version": s.version,
                                     "size": stat(signedURL(file)).0]
            if let x = s.expires { sj["expires"] = iso.string(from: x) }
            j["signed"] = sj
        } else {
            j["signed"] = NSNull()
        }
        return j
    }

    // ---- helpers

    static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .secondsSince1970 // sub-second, so a file's date compares as it is
        e.outputFormatting = [.sortedKeys]
        return e
    }()
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .secondsSince1970
        return d
    }()
}
