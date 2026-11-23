// F374: the IPA of an app on the phone (Installed Apps' Decrypt) and a copy of a library IPA with tweaks in (Build IPA
// with Tweaks), Foundation only so it is built and tested on Linux with the signer (native/test_decrypted_ipa.py,
// tests/decrypted/main.swift). The bridge around it is native/Sources/InstalledApps.swift.
//
//   DecryptedIPA.parse(helperOut)                  ifizbox-helper decrypt-app's "App: " and "Still encrypted " lines
//   DecryptedIPA.blocking(left)                    of those, the ones outside an extension: Decrypt fails on them
//   DecryptedIPA.pack(app:decrypted:left:to:say:)  Payload/<App>.app zipped: the decrypted files in place of the
//                                                  originals; SC_Info/ and extensions still encrypted left out
//   DecryptedIPA.withTweaks(src, tweaks, to:)      the copy: entries copied raw, the main executable with the weak
//                                                  load commands (MachOEdit.inject), the tweak files under the .app
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum DecryptedIPA {
    static let deflateMax: UInt64 = 32 << 20 // bigger files are stored, read a piece at a time

    struct Decrypted: Equatable { let app: URL; let left: [String] }

    // The helper's "App: <path>" and "Still encrypted <path>: <why>" lines.
    static func parse(_ out: String) throws -> Decrypted {
        var app: String?, left = [String]()
        for line in out.split(separator: "\n") {
            if line.hasPrefix("App: ") { app = String(line.dropFirst(5)) }
            else if line.hasPrefix("Still encrypted "), let colon = line.range(of: ": ", options: .backwards) {
                left.append(String(line[line.index(line.startIndex, offsetBy: 16)..<colon.lowerBound]))
            }
        }
        guard let a = app, a.hasSuffix(".app") else { throw SignError("decrypt", "ifizbox-helper didn't say where the app is") }
        return Decrypted(app: URL(fileURLWithPath: a, isDirectory: true), left: left)
    }

    // What of the .app stays out of the IPA: SC_Info folders (the App Store's licence files for this account), and
    // each extension (.appex) holding a file still encrypted (it couldn't run). Paths are relative to the .app.
    static func leftOut(_ rel: String, left: [String]) -> Bool {
        let parts = rel.split(separator: "/")
        if parts.contains("SC_Info") { return true }
        for l in left {
            let lp = l.split(separator: "/")
            guard let x = lp.firstIndex(where: { $0.hasSuffix(".appex") }) else { continue }
            if parts.count > x, Array(parts[0...x]) == Array(lp[0...x]) { return true }
        }
        return false
    }

    // The files still encrypted that aren't inside an extension (a framework, the app's own): the app couldn't run
    // from such an IPA, so Decrypt fails on them instead of packing it.
    static func blocking(_ left: [String]) -> [String] {
        left.filter { !$0.split(separator: "/").contains { $0.hasSuffix(".appex") } }
    }

    // The extensions left out, for the progress page ("PlugIns/A.appex").
    static func leftOutExtensions(_ left: [String]) -> [String] {
        var out = [String]()
        for l in left {
            guard let x = l.range(of: ".appex/") else { continue }
            let e = String(l[..<x.lowerBound]) + ".appex"
            if !out.contains(e) { out.append(e) }
        }
        return out
    }

    // The .app at `app` zipped to `out` as Payload/<App>.app/..., each regular file taken from `decrypted` (the
    // same relative path) when it is there, else from the .app. `progress(fraction)` after each file.
    static func pack(app: URL, decrypted: URL, left: [String], to out: URL, say: (String) -> Void,
                     progress: (Double) -> Void = { _ in }) throws {
        let fm = FileManager.default
        guard let walk = fm.enumerator(atPath: app.path) else { throw SignError("decrypt", "can't read \(app.path)") }
        var items = [String]()
        while let rel = walk.nextObject() as? String { if !leftOut(rel, left: left) { items.append(rel) } }
        for e in leftOutExtensions(left) { say("Left out \(e): still encrypted") }
        let zip = try ZipWriter(url: out)
        let top = "Payload/\(app.lastPathComponent)/"
        try zip.add("Payload/", Data(), mode: 0o40755)
        try zip.add(top, Data(), mode: 0o40755)
        for (i, rel) in items.enumerated() {
            let src = app.appendingPathComponent(rel)
            let attrs = try fm.attributesOfItem(atPath: src.path)
            let type = attrs[.type] as? FileAttributeType
            let perm = UInt32((attrs[.posixPermissions] as? NSNumber)?.uint32Value ?? 0o644) & 0o7777
            if type == .typeDirectory {
                try zip.add(top + rel + "/", Data(), mode: 0o40000 | (perm == 0 ? 0o755 : perm))
            } else if type == .typeSymbolicLink {
                let target = try fm.destinationOfSymbolicLink(atPath: src.path)
                try zip.add(top + rel, Data(target.utf8), mode: 0o120755, level: 0)
            } else if type == .typeRegular {
                let mine = decrypted.appendingPathComponent(rel)
                let file = fm.fileExists(atPath: mine.path) ? mine : src
                try addFile(zip, top + rel, file, mode: 0o100000 | perm)
            }
            progress(Double(i + 1) / Double(max(items.count, 1)))
        }
        zip.close()
    }

    static func addFile(_ zip: ZipWriter, _ name: String, _ file: URL, mode: UInt32) throws {
        let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.uint64Value ?? 0
        if size <= deflateMax {
            try autoreleasepool { try zip.add(name, try Data(contentsOf: file), mode: mode) }
            return
        }
        // stored: the CRC first, a piece at a time, then the bytes copied the same way
        let h = try FileHandle(forReadingFrom: file)
        var crc: UInt32 = 0
        while true {
            let more: Bool = autoreleasepool {
                let d = h.readData(ofLength: 4 << 20)
                if d.isEmpty { return false }
                crc = d.withUnsafeBytes { p in UInt32(truncatingIfNeeded: crc32(UInt(crc), p.bindMemory(to: Bytef.self).baseAddress, uInt(d.count))) }
                return true
            }
            if !more { break }
        }
        h.closeFile()
        try zip.add(name, file: file, size: size, crc: crc, mode: mode)
    }

    // The library name of the copy with tweaks: "<App> <version> (tweaks).ipa" from "<App> <version> (decrypted).ipa".
    static func tweakedName(_ file: String) -> String {
        var stem = file.lowercased().hasSuffix(".ipa") ? String(file.dropLast(4)) : file
        if let r = stem.range(of: #" \(decrypted\)( \d+)?$"#, options: .regularExpression) { stem.removeSubrange(r) }
        return stem + " (tweaks)"
    }

    // The IPA at src copied entry by entry (raw), the main executable with the load commands added, the tweak files
    // put under the .app (replacing any of the same path). -> the load paths added. Refuses an executable still
    // encrypted (an App Store copy: the commands would go in, but the app couldn't run).
    static func withTweaks(_ src: URL, _ t: TweakSet, to out: URL) throws -> [String] {
        let zip = try ZipReader(url: src)
        guard let info = zip.entries.first(where: { e in
            let p = e.name.split(separator: "/", omittingEmptySubsequences: false)
            return p.count == 3 && p[0] == "Payload" && p[1].hasSuffix(".app") && p[2] == "Info.plist"
        }) else { throw SignError("bad_ipa", "The IPA has no Payload/<App>.app/Info.plist.") }
        let top = String(info.name.dropLast("Info.plist".count))
        let plist = (try? PropertyListSerialization.propertyList(from: try zip.data(info, limit: 8 << 20), format: nil)) as? [String: Any]
        guard let exe = plist?["CFBundleExecutable"] as? String, !exe.isEmpty, !exe.contains("/") else {
            throw SignError("bad_ipa", "The app's Info.plist names no executable.")
        }
        guard let main = zip.entries.first(where: { $0.name == top + exe }) else {
            throw SignError("bad_ipa", "The app's executable \(exe) is missing.")
        }
        var data = try zip.data(main)
        if try encrypted(data) { throw SignError("encrypted", "This IPA is still encrypted. Decrypt it first.") }
        let injected: [String]
        (data, injected) = try MachOEdit.inject(data, t.inject)
        let replaced = Set(t.files.map { top + $0.path })
        let w = try ZipWriter(url: out)
        for e in zip.entries where !replaced.contains(e.name) {
            if e.name == main.name { try w.add(e.name, data, mode: e.unixMode) } else { try w.copy(e, from: zip) }
        }
        for f in t.files {
            let macho = f.data.count >= 4 && MachO.isMachO([UInt8](f.data.prefix(4)))
            try w.add(top + f.path, f.data, mode: macho ? 0o100755 : 0o100644)
        }
        w.close()
        return injected
    }

    // Whether a 64-bit slice still has LC_ENCRYPTION_INFO_64 with cryptid != 0.
    static func encrypted(_ d: Data) throws -> Bool {
        for (off, _) in MachOEdit.slices(d) where off + 32 <= d.count && d.le32(at: off) == MachO.magic64 {
            for c in try MachOEdit.commands(d, at: off) where c.cmd == 0x2C && c.offset + 20 <= d.count {
                if d.le32(at: c.offset + 16) != 0 { return true }
            }
        }
        return false
    }
}
