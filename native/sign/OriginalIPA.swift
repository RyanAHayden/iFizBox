// F343: the IPA each signed app was signed from, as it came (unsigned), kept as Library/Caches/<bundle ID>.ipa (the
// bundle ID it was installed as), so Re-sign signs from it instead of downloading it again. iOS may purge Caches
// under storage pressure: Re-sign then downloads, as before. Kept only for apps whose IPA came from an http(s) URL:
// My IPAs files have the library's own copy, and iFizBox itself is signed from its bundle or its own download.
// Replaced on every install or upgrade: the signer's input is staged once it is signed and replaces the kept one when
// the install's record is written (Sideload.saveRecords), which also removes it with the record. The record's sha256 is the kept file's: Re-sign uses the file only when it still matches.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum OriginalIPA {
    static let dir: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]

    // Where `bundleID`'s IPA is kept; nil for an ID that isn't a plain file name (a bundle ID is letters, digits, . and -).
    static func url(_ bundleID: String, in dir: URL = dir) -> URL? {
        let ok = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_")
        guard !bundleID.isEmpty, bundleID.count <= 255, !bundleID.hasPrefix("."),
              bundleID.unicodeScalars.allSatisfy(ok.contains) else { return nil }
        return dir.appendingPathComponent(bundleID + ".ipa")
    }

    // Whether an app signed from `source` (the record's url) keeps its IPA: one downloaded over http(s), and not
    // iFizBox itself (`own`, its bundle ID).
    static func keeps(source: String, bundleID: String, originalBundleID: String, own: String?) -> Bool {
        let s = source.lowercased()
        guard s.hasPrefix("https://") || s.hasPrefix("http://") else { return false }
        if let me = own, !me.isEmpty, bundleID == me || originalBundleID == me { return false }
        return url(bundleID) != nil
    }

    // A signed IPA waiting for its install: <bundle ID>.<sha256>.pending, until its record is written (commit) or the
    // install doesn't happen (discard). The one kept before stays in place meanwhile.
    static func pending(_ bundleID: String, sha256: String, in dir: URL = dir) -> URL? {
        let sha = sha256.lowercased()
        guard url(bundleID, in: dir) != nil, sha.count == 64, sha.allSatisfy({ $0.isHexDigit }) else { return nil }
        return dir.appendingPathComponent("\(bundleID).\(sha).pending")
    }

    // Moves `input` aside for `bundleID` until its install is recorded. -> whether it is staged.
    @discardableResult
    static func stage(_ input: URL, bundleID: String, sha256: String, in dir: URL = dir) -> Bool {
        guard let dest = pending(bundleID, sha256: sha256, in: dir) else { return false }
        let fm = FileManager.default
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try? fm.removeItem(at: dest)
        do { try fm.moveItem(at: input, to: dest); return true } catch { return false }
    }

    // The install is recorded: the staged IPA replaces the one kept before (nothing changes when none is staged).
    static func commit(_ bundleID: String, sha256: String, in dir: URL = dir) {
        guard let src = pending(bundleID, sha256: sha256, in: dir), let dest = url(bundleID, in: dir),
              FileManager.default.fileExists(atPath: src.path) else { return }
        try? FileManager.default.removeItem(at: dest)
        try? FileManager.default.moveItem(at: src, to: dest)
    }

    // The install didn't happen: the staged IPA goes, the one kept before stays.
    static func discard(_ bundleID: String, sha256: String, in dir: URL = dir) {
        guard let p = pending(bundleID, sha256: sha256, in: dir) else { return }
        try? FileManager.default.removeItem(at: p)
    }

    static func remove(_ bundleID: String, in dir: URL = dir) {
        guard let u = url(bundleID, in: dir) else { return }
        try? FileManager.default.removeItem(at: u)
    }

    enum Take: Equatable {
        case file(URL)  // a copy at the asked path, matching the record
        case missing    // never kept, or purged by iOS
        case mismatch   // there, but not the IPA the record was signed from (removed)
        case unknown    // the record has no hash to check it against (from before F343)
        case unreadable // there and matching, but it couldn't be linked or copied
    }

    // The kept IPA of `bundleID` at `to` (a hard link, else a copy: the signer deletes its input), when its SHA-256
    // (`hash`, lowercase hex) is the record's `sha256`. A file that doesn't match is removed, so it is downloaded again.
    static func take(_ bundleID: String, sha256: String?, to: URL, in dir: URL = dir, hash: (URL) -> String?) -> Take {
        guard let src = url(bundleID, in: dir), FileManager.default.fileExists(atPath: src.path) else { return .missing }
        guard let want = sha256?.lowercased(), !want.isEmpty else { return .unknown }
        guard hash(src) == want else { remove(bundleID, in: dir); return .mismatch }
        let fm = FileManager.default
        try? fm.removeItem(at: to)
        do { try fm.linkItem(at: src, to: to) } catch {
            do { try fm.copyItem(at: src, to: to) } catch { return .unreadable }
        }
        return .file(to)
    }

    // The bundle IDs whose kept IPA goes when `old` records become `new`: a record removed, or replaced by one that
    // keeps none (sha256 nil: a My IPAs install of the same app). A new hash means the file was already replaced.
    static func dropped(old: [SignedRecord], new: [SignedRecord]) -> [String] {
        let now = Dictionary(new.map { ($0.bundleID, $0) }, uniquingKeysWith: { _, b in b })
        return old.filter { $0.sha256 != nil && (now[$0.bundleID].map { $0.sha256 == nil } ?? true) }.map(\.bundleID)
    }
}

extension OriginalIPA {
    // F400: the `.pending` files an app killed mid-install left behind (at launch no install is under way).
    static func sweepPending(in dir: URL = dir) {
        let fm = FileManager.default
        for n in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where n.hasSuffix(".pending") {
            let parts = n.dropLast(".pending".count).split(separator: ".", omittingEmptySubsequences: false)
            guard parts.count > 1, let sha = parts.last, sha.count == 64, sha.allSatisfy({ $0.isHexDigit }) else { continue }
            try? fm.removeItem(at: dir.appendingPathComponent(n))
        }
    }
}

private func waitingKey(_ url: String) -> Data { sha256(Data(url.utf8)) } // outside: `sha256` is a field below

// F400: a downloaded IPA (unsigned, whole) whose install hasn't gone through: <key>.ipa and <key>.json (this struct) in
// `dir`, the key its URL's hash. Kept the moment the download ends, so a failed signing, route check, copy or install,
// a dismissed prompt or a killed app leave it there, and the next install of that URL and version takes it instead of
// downloading it again (Sources/IPAFetch.swift). One per app (the IPA's own bundle ID). It goes once installed, when the
// file or the server's copy is another one, when the signer says the IPA is damaged, with the app's record on the
// user's Delete, and `life` after its download. iOS may purge Caches any time.
struct WaitingIPA: Codable, Equatable {
    // What the source listed when the IPA was asked for (a call's `listed`); nil: not said.
    struct Listed: Equatable {
        var version: String? = nil, size: Int64? = nil
        init(version: String? = nil, size: Int64? = nil) { self.version = version; self.size = size }
        init(_ params: [String: Any]) {
            let l = params["listed"] as? [String: Any] ?? [:]
            version = (l["version"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            size = (l["size"] as? NSNumber)?.int64Value
            if let n = size, n <= 0 { size = nil }
        }
    }
    // The server's answer to the download: its validators (lower-cased header names), and whether it came over plain http.
    struct Answer: Equatable {
        var headers = [String: String](), plain = false
    }

    var url: String
    var version: String?      // as listed
    var listedSize: Int64?
    var size: Int64
    var sha256: String
    var etag: String?
    var lastModified: String?
    var plain: Bool           // downloaded over plain http (the user's Install Anyway)
    var app: String           // the IPA's own bundle ID and version
    var appVersion: String
    var kept: Date

    static let life: TimeInterval = 7 * 24 * 3600
    // The app's own folder in Caches: the jailbreak app has no container, its Caches are every app's.
    static let dir = OriginalIPA.dir.appendingPathComponent("\(SignOptions.selfBundleID)/waiting", isDirectory: true)
    private static let lock = NSLock()
    private static func locked<T>(_ f: () -> T) -> T { lock.lock(); defer { lock.unlock() }; return f() }

    private static func key(_ url: String) -> String { String(IPALibrary.hex(waitingKey(url)).prefix(40)) }
    static func file(_ url: String, in dir: URL = dir) -> URL { dir.appendingPathComponent(key(url) + ".ipa") }
    private static func note(_ url: String, in dir: URL) -> URL { dir.appendingPathComponent(key(url) + ".json") }

    private static func length(_ u: URL) -> Int64? {
        ((try? FileManager.default.attributesOfItem(atPath: u.path))?[.size] as? NSNumber)?.int64Value
    }
    private static func read(_ url: String, in dir: URL) -> WaitingIPA? {
        guard let d = try? Data(contentsOf: note(url, in: dir)), let w = try? JSONDecoder().decode(WaitingIPA.self, from: d),
              w.url == url else { return nil }
        return w
    }
    private static func all(in dir: URL) -> [WaitingIPA] {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".json") }.compactMap {
            (try? Data(contentsOf: dir.appendingPathComponent($0))).flatMap { try? JSONDecoder().decode(WaitingIPA.self, from: $0) }
        }
    }
    private static func drop(_ url: String, in dir: URL) {
        try? FileManager.default.removeItem(at: note(url, in: dir))
        try? FileManager.default.removeItem(at: file(url, in: dir))
    }

    // A second name for `src` at `to`: a hard link (no space of its own) where `link`, else a copy (a clone on APFS).
    // The jailbreak app copies: ifizbox-helper takes no IPA with two names.
    private static func second(_ src: URL, _ to: URL, link: Bool) -> Bool {
        let fm = FileManager.default
        try? fm.removeItem(at: to)
        if link, (try? fm.linkItem(at: src, to: to)) != nil { return true }
        return (try? fm.copyItem(at: src, to: to)) != nil
    }

    // Keeps the whole download at `src`, which stays where it is. Nothing is kept of a file that doesn't open as an IPA.
    @discardableResult
    static func keep(_ src: URL, url: String, listed: Listed, answer: Answer, link: Bool = true, in dir: URL = dir,
                     now: Date = Date(), hash: (URL) -> String?) -> WaitingIPA? {
        guard let d = try? Inspect.ipa(src), !d.bundleID.isEmpty, let size = length(src), let sha = hash(src) else {
            locked { drop(url, in: dir) }
            return nil
        }
        let w = WaitingIPA(url: url, version: listed.version, listedSize: listed.size, size: size, sha256: sha.lowercased(),
                           etag: answer.headers["etag"], lastModified: answer.headers["last-modified"], plain: answer.plain,
                           app: d.bundleID, appVersion: d.version, kept: now)
        return locked {
            let fm = FileManager.default
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            for o in all(in: dir) where o.app == w.app || o.url == url || now.timeIntervalSince(o.kept) >= life { drop(o.url, in: dir) }
            drop(url, in: dir)
            // the note last: a file without one is swept, never used
            guard second(src, file(url, in: dir), link: link), let j = try? JSONEncoder().encode(w),
                  (try? j.write(to: note(url, in: dir), options: .atomic)) != nil else { drop(url, in: dir); return nil }
            return w
        }
    }

    // The one waiting for `url`, when it may be used for what is `listed` now; anything stale goes. `plain`: whether one
    // downloaded over plain http may be (no: it stays, for after the page's Install Anyway).
    static func find(_ url: String, listed: Listed, plain: Bool, in dir: URL = dir, now: Date = Date()) -> WaitingIPA? {
        locked {
            guard let w = read(url, in: dir) else { return nil }
            let age = now.timeIntervalSince(w.kept)
            let sameVersion = listed.version == nil || listed.version == (w.version ?? w.appVersion)
            let sameSize = listed.size == nil || w.listedSize == nil || listed.size == w.listedSize
            guard age < life, age > -life, sameVersion, sameSize, length(file(url, in: dir)) == w.size else {
                drop(url, in: dir)
                return nil
            }
            return w.plain && !plain ? nil : w
        }
    }

    // Whether the server's answer (a HEAD's) says its file is another one. Only a 2xx that can be compared says so.
    func changed(status: Int, headers: [String: String]) -> Bool {
        guard (200..<300).contains(status) else { return false }
        func bare(_ e: String) -> String { e.hasPrefix("W/") ? String(e.dropFirst(2)) : e }
        if let a = etag, let b = headers["etag"] { return bare(a) != bare(b) }
        if let a = lastModified, let b = headers["last-modified"] { return a != b }
        if headers["content-encoding"] == nil, let n = headers["content-length"].flatMap({ Int64($0) }), n > 0 { return n != size }
        return false
    }

    // This one at `to` when its bytes are still the ones downloaded; otherwise it goes, and nil.
    func take(to: URL, link: Bool = true, in dir: URL = dir, hash: (URL) -> String?) -> URL? {
        let here = WaitingIPA.locked { WaitingIPA.second(WaitingIPA.file(url, in: dir), to, link: link) }
        guard here else { return nil }
        guard WaitingIPA.length(to) == size, hash(to)?.lowercased() == sha256 else {
            try? FileManager.default.removeItem(at: to)
            WaitingIPA.remove(url, in: dir)
            return nil
        }
        return to
    }

    static func remove(_ url: String, in dir: URL = dir) { locked { drop(url, in: dir) } }

    // Installed from `url`: the one waiting goes, unless it is another IPA (`sha256`, the installed one's, when known).
    static func installed(_ url: String, sha256: String?, in dir: URL = dir) {
        locked {
            if let s = sha256?.lowercased(), let w = read(url, in: dir), w.sha256 != s { return }
            drop(url, in: dir)
        }
    }

    // The user removed the app: the one waiting for it goes too.
    static func remove(app: String, in dir: URL = dir) {
        guard !app.isEmpty else { return }
        locked { for w in all(in: dir) where w.app == app { drop(w.url, in: dir) } }
    }

    // A known-malware IPA isn't kept.
    static func remove(sha256: String, in dir: URL = dir) {
        locked { for w in all(in: dir) where w.sha256 == sha256.lowercased() { drop(w.url, in: dir) } }
    }

    // The signer's errors that say the IPA itself can't be used, so a fresh download is the only way on.
    // `tweaks`: tweaks were injected, whose own Mach-Os can be the bad one, so that code says nothing of the IPA.
    static func damaged(_ e: Error, tweaks: Bool = false) -> Bool {
        if let z = e as? ZipError { // not the signer's own writing (a full disk)
            return !["can't write", "zlib ", "deflate failed"].contains { z.description.hasPrefix($0) }
        }
        let code = (e as? SignError)?.code
        return code == "bad_ipa" || (code == "bad_macho" && !tweaks)
    }

    // Whether `file` is a whole IPA: it opens as one and every file in it reads (CRC). For the jailbreak app, whose
    // helper says "can't unpack" for a full disk too.
    static func sound(_ file: URL) -> Bool {
        guard (try? Inspect.ipa(file)) != nil, let z = try? ZipReader(url: file) else { return false }
        do { for e in z.entries { try z.read(e) { _ in } } } catch { return !damaged(error) }
        return true
    }

    // At launch: what expired or lost its half goes, and this app's own update once it is the one running (its install
    // ends the app, so nothing else can).
    static func sweep(own: (id: String, version: String)? = nil, in dir: URL = dir, now: Date = Date()) {
        locked {
            let fm = FileManager.default
            var good = Set<String>()
            for w in all(in: dir) {
                let mine = own.map { $0.version == w.appVersion && ($0.id == w.app || w.app == SignOptions.selfBundleID) } ?? false
                let age = now.timeIntervalSince(w.kept)
                if mine || age >= life || age <= -life || length(file(w.url, in: dir)) != w.size { drop(w.url, in: dir) }
                else { good.formUnion([key(w.url) + ".json", key(w.url) + ".ipa"]) }
            }
            for n in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where !good.contains(n) {
                try? fm.removeItem(at: dir.appendingPathComponent(n))
            }
        }
    }
}
